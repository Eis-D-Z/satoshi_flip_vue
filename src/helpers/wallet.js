import {JsonRpcProvider, Ed25519Keypair, RawSigner} from "@mysten/sui.js";
import { fromB64 } from "@mysten/bcs";
import {localStorageKeys, bankerAddress, keySeed, suiRpcUrl} from "./constants";
import {computed, onMounted, ref} from "vue";
import {useAuthStore} from "../stores/auth";
import {useUiStore} from "../stores/ui";
import {ethos_logo, logo} from "../assets/icons";

const provider = new JsonRpcProvider(suiRpcUrl);

const walletProviders = {
    suiWallet: {
        key: 'suiWallet',
        title: 'Sui Wallet',
        logo: logo,
        url: 'https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil'
    },
    ethosWallet: {
        key: 'ethosWallet',
        title: 'Ethos Wallet',
        logo: ethos_logo,
        url: 'https://chrome.google.com/webstore/detail/ethos-sui-wallet/mcbigmjiafegjnnogedioegffbooigli'
    }
}

export function useWallet() {
    const authStore = useAuthStore();
    const uiStore = useUiStore();
    const permissionGrantedError = ref("");

    const updateSuiAddress = (address, provider) => {
        if(address){
            localStorage.setItem(localStorageKeys.address, address);
            localStorage.setItem(localStorageKeys.walletProvider, provider);
        } else{
            localStorage.removeItem(localStorageKeys.address);
            localStorage.removeItem(localStorageKeys.walletProvider);
        }
        authStore.hasWalletPermission = !!address;
        authStore.userSuiAddress = address || null
    }

    const walletAddress = localStorage.getItem(localStorageKeys.address);
    const walletProvider = localStorage.getItem(localStorageKeys.walletProvider);

    if(walletAddress && walletProvider){
        updateSuiAddress(walletAddress, walletProvider);
    }

    // check wallet permissions. We might already have a wallet address but our permissions
    // are revoked by the wallet interface.

    const verifyWalletPermissions = () => {

        if(!authStore.walletProvider || !window[authStore.walletProvider]) return logout();

        window[authStore.walletProvider].hasPermissions().then(res=>{
            if(!res) return logout();
            getUserCoins();
            // getUserCasinoOwnershipAndUserCoinAddresses();
        }).catch(e=>{
            logout();
        });
    }

    const getUserCoins = () => {
        const address = getAddress();
        if(!address) return;

        provider.getObjectsOwnedByAddress(address).then(res =>{
            let coinAddresses = res.filter(x => x.type.includes('Coin'));

            provider.getObjectBatch(coinAddresses.map(x => x.objectId)).then(res=>{

                const coins = res.map(x => {
                    return {
                        id: x?.details?.data?.fields?.id?.id,
                        balance: x?.details?.data?.fields?.balance
                    }
                });
                authStore.coins = coins;
            })

        }).catch(e =>{
            uiStore.setNotification(e.message);
        });
    }

    // sets up ourselves to be able to sign transactions
    // needed to call start_game and end_game
    const setSigner = () => {
        const keypair = Ed25519Keypair.fromSeed(fromB64(keySeed));
        const signer = new RawSigner(keypair, provider);
        authStore.signer = signer;
    }

    // returns wallet address
    const getAddress = () => {
        return authStore.userSuiAddress;
    }

    const getSigner = () => {
        if (!authStore.signer) {
            setSigner();
        }
        return authStore.signer;
    }

    // checks if we have a sui address to do any requests
    const isPermissionGranted = computed(() => {
        return authStore.userSuiAddress !== null;
    });

    // remove saved wallet address. Can't revoke permissions yet.
    const logout = async () => {
        if(authStore.walletProvider === walletProviders.ethosWallet.key && window[authStore.walletProvider]){

            await window[authStore.walletProvider].disconnect();
        }
        updateSuiAddress(null);
        authStore.$reset();
    }

    // prompt to request access to the wallet.
    const requestWalletAccess = (provider) => {
        // if we dont have the extension, redirect the user to the extension page!
        if(!window[provider]) return window.open(walletProviders[provider].url, '_blank').focus();

        permissionGrantedError.value = "";

        window[provider].requestPermissions().then(async res=>{
            authStore.walletProvider = provider;

            await window[provider].getAccounts().then(accounts => {
                updateSuiAddress(accounts[0], provider);
                getUserCoins();
                // getUserCasinoOwnershipAndUserCoinAddresses();
            });
        }).catch(e=>{
            permissionGrantedError.value = `You need to give us ${walletProviders[provider].title} permissions to continue.`;
            updateSuiAddress(null);
        });
    }

    const getSuitableCoinId = (amount) => {

        let coinId = null;
        for(let coin of authStore.coins){
            if(coin.balance >= amount){
                coinId = coin.id
                break;
            }
        }
        return coinId;
    }

    const getLargestBankCoinId = () => {
        let coinId = null;
        let balance = 0;
        for (let coin of authStore.bankCoins) {
            if (coin.balance >= balance) {
                coinId = coin.id;
                balance = coin.balance;
            }
        }

        return coinId;
    }

    const executeMoveCall = async (params) => {
        if(!authStore.walletProvider || !window[authStore.walletProvider]) return logout();

        return window[authStore.walletProvider].executeMoveCall(params);
    }

    return {
        provider,
        walletProviders,
        verifyWalletPermissions,
        requestWalletAccess,
        getAddress,
        getSigner,
        logout,
        setSigner,
        executeMoveCall,
        getSuitableCoinId,
        getLargestBankCoinId,
        getUserCoins,
        isPermissionGranted,
        permissionGrantedError
    }
}