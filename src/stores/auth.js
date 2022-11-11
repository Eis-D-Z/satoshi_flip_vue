import {defineStore} from "pinia";
import {localStorageKeys} from "../helpers/constants";


export const useAuthStore = defineStore({
    id: 'auth',
    state: () => ({
        walletProvider: localStorage.getItem(localStorageKeys.walletProvider),
        hasWalletPermission: false,
        userSuiAddress: localStorage.getItem(localStorageKeys.walletProvider),
        // casinoAdmin: {
        //     isAdmin: false,
        //     objectAddress: null
        // },
        signer: null,
        coins: [],
        bankCoins: [],
        toggleWalletAuthModal: false
    }),

    actions:{
    }
});