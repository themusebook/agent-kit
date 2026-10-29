// Polyfills web3.js needs on React Native, before anything else loads.
import "react-native-get-random-values";
import { Buffer } from "buffer";
(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;

import { registerRootComponent } from "expo";
import App from "./src/App";

registerRootComponent(App);
