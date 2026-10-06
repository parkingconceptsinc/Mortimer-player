import React from "react";
import { createRoot } from "react-dom/client";
import { Player } from "./Player";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Player />
  </React.StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/Mortimer-player/sw.js");
  });
}
