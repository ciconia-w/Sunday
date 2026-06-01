<script setup lang="ts">
import { RouterView } from "vue-router";
import initializeInjectedMode from "./initializePiMode";
import initializeQtMode from "./prodmode";

declare const qt: { webChannelTransport?: unknown } | undefined;

if (typeof qt !== "undefined" && qt?.webChannelTransport) {
    initializeQtMode();
} else {
    initializeInjectedMode();
}
</script>

<template>
  <RouterView />
</template>
