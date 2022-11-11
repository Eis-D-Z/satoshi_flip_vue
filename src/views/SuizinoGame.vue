<script setup>
import { SHA3 } from 'sha3';
import {JsonRpcProvider} from "@mysten/sui.js";
import {ref, onMounted,onUnmounted, reactive, onBeforeMount} from 'vue'
import {logo} from "../assets/icons";
import {useAuthStore} from "../stores/auth";
import {moduleAddress, bankerAddress, suiRpcUrl} from "../helpers/constants";
import {useWallet} from "../helpers/wallet";
import {useUiStore} from "../stores/ui";

const authStore = useAuthStore();
const uiStore = useUiStore();
const {executeMoveCall, getAddress, getSuitableCoinId, getSigner, getLargestBankCoinId, getUserCoins} = useWallet();

const gameStatuses = {
  STANDBY: 'STANDBY',
  LOSS: 'LOSS',
  WIN: 'WIN',
  INITIALIZED: 'INITIALIZED'
}

let currentSecret = "";
let currentGameId = ref("");
const signer = getSigner();
const playerGuess = ref("1");
const spinningList = ["heads", "tails"];
const gameStatus = ref(gameStatuses.STANDBY);
const gameStarted = ref(false);
const gameInitialized = ref(false);
const isLoading = ref(true);
const gameResultsObject = ref({});
const gameResults = ref([]);
const totalGames = ref(0);
const wheelSlots = reactive([
  {
    id: 0,
    started: false,
    randomSlides: [],
    ended: false
  }
]);

let initialSpinInterval = ref();

const getNewSecretAndHash = () => {
  const secret = String(Math.floor(Math.random() * 10000000));
  const h = new SHA3(256);
  h.update(secret);
  const hash = h.digest();
  return {secret: secret, hash: Array.from(hash)};
}

const setBankCoins = () => {
  const provider = new JsonRpcProvider(suiRpcUrl);
  provider.getObjectsOwnedByAddress(bankerAddress).then(res =>{

      let coinObjects = res.filter(x => x.type.includes('Coin'));

      provider.getObjectBatch(coinObjects.map(x => x.objectId)).then(res=>{

          const coins = res.map(x => {
              return {
                  id: x?.details?.data?.fields?.id?.id,
                  balance: x?.details?.data?.fields?.balance
              }
          });
          authStore.bankCoins = coins;
          createGame();
      })

  }).catch(e =>{
      uiStore.setNotification(e.message);
  });
}

// TODO: max bet is hardcoded here, it should be a variable/
// Min bet as well.
const createGame = () => {
  if (gameInitialized.value || gameStarted.value) return;
  isLoading.value = true;
  const coinId = getLargestBankCoinId();
  const {secret, hash} = getNewSecretAndHash();
  currentSecret = secret;
  const minBet = 100;
  const maxBet = 5000;
  gameResults.value = [];
  console.log('signer', signer);
  signer.executeMoveCallWithRequestType({
    packageObjectId: moduleAddress,
    module: 'satoshi_flip',
    typeArguments: [],
    function: "start_game",
    arguments: [hash, coinId, maxBet, minBet],
    gasBudget: 1000
  }).then(res => {
    const effects = res?.EffectsCert ? res?.EffectsCert?.effects?.effects : res?.effects;
    const status = effects?.status?.status;
    if (status === "success") {
      let newGameResult = effects?.events?.find(x => x.newObject) || {};
      currentGameId.value = newGameResult.newObject.objectId;
      gameInitialized.value = true;
      isLoading.value = false;
    }
    
  })
}
// TODO: Stake amount is set to 5000 hardcoded, player should decide stake between min and max bet
const executeGamble = (ev) => {
  playerGuess.value = ev.currentTarget.id === "heads"? 1 : 0;
  const address = getAddress();
  if(!address) return;
  if(gameStarted.value) return;
  // resetGame();
  gameStarted.value = true;
  isLoading.value = true;
  if (!currentGameId) return;

  const coinId = getSuitableCoinId(5000);
  const stakeAmount = 5000;

  executeMoveCall({
    packageObjectId: moduleAddress,
    module: 'satoshi_flip',
    typeArguments: [],
    arguments: [currentGameId.value, playerGuess.value, coinId, stakeAmount],
    function: 'bet',
    gasBudget: 10000
  }).then(res => {
    totalGames.value++;
    const effects = res?.EffectsCert ? res?.EffectsCert?.effects?.effects : res?.effects;
    const status = effects?.status?.status;
    if(status === 'success'){
      // If it is a success then we can end the game
      signer.executeMoveCallWithRequestType({
        packageObjectId: moduleAddress,
        module: 'satoshi_flip',
        typeArguments: [],
        arguments: [currentGameId.value, currentSecret],
        function: 'end_game',
        gasBudget: 10000
      }).then(res => {
        const effects = res?.EffectsCert ? res?.EffectsCert?.effects?.effects : res?.effects;
        const status = effects?.status?.status;
        if (status === 'success') {
          let gameResultEvents = effects?.events;
          // get outcome
          gameStatus.value = gameStatuses.LOSS;
          let outcome = playerGuess.value === 1 ? ["tails"] : ["heads"];
          for (let event of gameResultEvents) {
            if (event?.coinBalanceChange && event?.coinBalanceChange?.owner?.AddressOwner === getAddress()) {
              gameStatus.value = gameStatuses.WIN;
              outcome = playerGuess.value === 1 ? ["heads"] : ["tails"];
            }
          }
          endGame(outcome);
          // const fields = {slot1: outcome}
          // gameResults.value = fields;
          // gameResultsObject.value = [fields.slot1]
        }
      })
    }else{
      uiStore.setNotification(res?.effects?.status?.error);
      resetGame();
    }
  }).catch(e=>{
    resetGame();
    uiStore.setNotification(e.message);
  })
}

const endGame = (outcome) => {
  const fields = {slot_1: outcome};
  gameResults.value = outcome;
  gameResultsObject.value = fields;
  // We just mark all slots as "started" and we let the interval that is already running
  // take care of showing the results. To make it more smooth,
  for(let [index, slot] of wheelSlots.entries()){
    slot.started = true;
    setTimeout(()=>{}, (index+1) * 600); // start wih 300ms difference
  }
}

//test method
// const executeGamble = (e) => {
//   const result = Math.floor(Math.random() * 2);
//   const outcome = result === 1 ? ["heads"] : ["tails"];
//   const fields = {slot_1: outcome };
//   gameResults.value = outcome;
//   gameResultsObject.value = fields;
//   const gamble = e.currentTarget.id === "heads" ? 1 : 0;
//   const won = result === gamble;
//   if (won) {
//     gameStatus.value = gameStatuses.WIN;
//   } else {
//     gameStatus.value = gameStatuses.LOSS;
//   }
//   for(let [index, slot] of wheelSlots.entries()){
//     slot.started = true;
//     setTimeout(()=>{}, (index+1) * 600); // start wih 300ms difference
//   }

// }

const setupSpinningInterval = (timeout) => {
  return setInterval(()=> {
    for (let slot of wheelSlots) {

      if(slot.ended) continue; // if slot selection ended. continue!

      // if slot slection has started, we pick one and then break
      if(slot.started){
        clearSpinningInterval();
        slot.randomSlides = gameResults.value;
        slot.ended = true;

        if(slot.id === wheelSlots.length - 1) checkGameStatus();
        continue;
      }
      slot.randomSlides = [...spinningList].sort(() => 0.5 - Math.random()).slice(0,2);
    }
  }, timeout);
}

const clearSpinningInterval = () => {
  clearInterval(initialSpinInterval.value);
}

onMounted(()=>{
  initialSpinInterval.value = setupSpinningInterval(120);
  setBankCoins();
});
onUnmounted(()=>{
  clearSpinningInterval();
});
const resetGame = () => {
  getUserCoins();
  isLoading.value = true;
  gameStarted.value = false;
  gameResults.value = null;
  gameStatus.value = gameStatuses.STANDBY;
  gameInitialized.value = false;
  setBankCoins();
  clearSpinningInterval();
  for(let slot of wheelSlots){
    slot.randomSlides = [];
    slot.started = false;
    slot.ended = false;
  }
  gameResultsObject.value = {};
  setupSpinningInterval(120);
}

const checkGameStatus = () =>{
  gameStarted.value = false;
  isLoading.value = false;
  let hasWon = true;
  let icon = null;
  // gameStatus.value = gameResultsObject.value.winnings > 0 ? gameStatuses.WIN : gameStatuses.LOSS;

  if(gameStatus.value === gameStatuses.WIN){
    uiStore.setNotification("Congratulations 🎉! You won 5000 MIST!", "success")
    setTimeout(() => {resetGame();}, 3000);
  }
  if(gameStatus.value === gameStatuses.LOSS){
    uiStore.setNotification("😔 You were unlucky this time. maybe try again")
    setTimeout(() => {resetGame();}, 3000);
  }
  // for(let slot of wheelSlots){
  //   if(!icon) {
  //     icon = slot.randomSlides[0];
  //     continue;
  //   }

  //   if(icon !== slot.randomSlides[0]){
  //     hasWon = false;
  //     break;
  //   }
  // }
}



</script>

<style>

.lucky-wheel-slot.win{
  @apply border-2 border-green-600;
}
.lucky-wheel-slot.loss{
  @apply border-2 border-red-700;
}
</style>

<template>
  <main class="container">

<!--    <h2>Please login to continue</h2>-->
    <div class="max-w-[700px] mx-auto mb-20 mt-6">

      <div class="py-6 text-center">
        <h2 class="text-3xl font-bold">
          🎉 Satoshi Flip 🎉
        </h2>
        <p>
          Guess the flip and win big rewards!
        </p>

      </div>
      <div class="lucky-wheel-slots grid grid-cols-3 gap-2 md:gap-5">
        <div v-for="slot of wheelSlots" :key="slot.id" :id="`wheel-slot-${slot.id}`"
             class="lucky-wheel-slot bg-white overflow-hidden dark:bg-gray-700 h-[250px] md:h-[320px] rounded-lg shadow flex items-center justify-center"
             :class="`${gameStatus.toLowerCase()}`">

          <div class="">
            <div v-for="(item) in slot.randomSlides" class="block w-full text-center text-5xl md:text-6xl py-6 ">
              {{item}}
            </div>
          </div>

        </div>
      </div>


      <div class="mt-6 text-center">

        <button v-if="!authStore.hasWalletPermission" class="bg-gray-800 mx-auto ease-in-out duration-500 hover:px-10 dark:bg-gray-800 flex items-center text-white px-5 py-2 rounded-full" @click="authStore.toggleWalletAuthModal = true">
          <div v-html="logo" class="logo-icon"></div> Connect your wallet to start playing!
        </button>
        <div v-else>
          <button id="tails"
                  class="bg-gray-800 mx-auto ease-in-out duration-500 hover:px-10 dark:bg-gray-800 flex items-center text-white px-5 py-2 rounded-full"
                  :class="isLoading || !authStore.hasWalletPermission ? 'opacity-70 cursor-default hover:px-5': ''"
                  @click="executeGamble">

            <div v-if="isLoading">
              <svg aria-hidden="true" class="w-5 h-5 text-gray-200 animate-spin dark:text-white fill-gray-800" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                      fill="currentColor"/>
                <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                      fill="currentFill"/>
              </svg>
            </div>
            <span v-else class="flex items-center">
              <div v-html="logo" class="logo-icon"></div>
              Tails 
              <span class="ml-2 text-sm">(5000 Mist)
              </span>
            </span>

          </button>
          <button
            id="heads"
            class="bg-gray-800 mx-auto ease-in-out duration-500 hover:px-10 dark:bg-gray-800 flex items-center text-white px-5 py-2 rounded-full"
            :class="isLoading || !authStore.hasWalletPermission ? 'opacity-70 cursor-default hover:px-5': ''"
            @click="executeGamble"
          >
          <div v-if="isLoading">
              <svg aria-hidden="true" class="w-5 h-5 text-gray-200 animate-spin dark:text-white fill-gray-800" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                      fill="currentColor"/>
                <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                      fill="currentFill"/>
              </svg>
            </div>
            <span v-else class="flex items-center">
              <div v-html="logo" class="logo-icon"></div>
              Heads 
              <span class="ml-2 text-sm">(5000 Mist)
              </span>
            </span>
          </button>
        </div>
        <p class="text-xs mt-5">If you guess the coin's outcome, your wins will be equal to your stake</p>
      </div>
    </div>
  </main>
</template>
