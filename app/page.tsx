"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";


// =========================================================
// TYPES
// =========================================================

interface Device {
  id: string;
  device_name: string;
  device_key: string;
  state: boolean;
  last_seen: string | null;
  online: boolean;
  updated_at: string;
}


// =========================================================
// SUPABASE
// =========================================================

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;


if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables."
  );
}


const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);


// =========================================================
// DEVICE
// =========================================================

const DEVICE_KEY = "esp32-001";


// Device is considered online if
// ESP32 was seen within the last 15 seconds.

const ONLINE_TIMEOUT = 15000;


// =========================================================
// HOME
// =========================================================

export default function Home() {

  const [device, setDevice] =
    useState<Device | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [changing, setChanging] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [now, setNow] =
    useState(Date.now());


  // =======================================================
  // LOAD DEVICE
  // =======================================================

  async function loadDevice() {

    const {
      data,
      error
    } = await supabase
      .from("devices")
      .select("*")
      .eq(
        "device_key",
        DEVICE_KEY
      )
      .single();


    if (error) {

      console.error(
        "LOAD DEVICE ERROR:",
        error
      );

      setMessage(
        `Unable to load device: ${error.message}`
      );

    } else if (data) {

      setDevice(
        data as Device
      );
    }


    setLoading(false);
  }


  // =======================================================
  // CHANGE DEVICE STATE
  // =======================================================

  async function setDeviceState(
    newState: boolean
  ) {

    if (!device || changing) {
      return;
    }


    setChanging(true);

    setMessage("");


    const {
      data,
      error
    } = await supabase
      .from("devices")
      .update({

        state: newState,

        updated_at:
          new Date().toISOString(),

      })
      .eq(
        "device_key",
        DEVICE_KEY
      )
      .select()
      .single();


    if (error) {

      console.error(
        "UPDATE DEVICE ERROR:",
        error
      );

      setMessage(
        `Failed to update device: ${error.message}`
      );

    } else if (data) {

      setDevice(
        data as Device
      );


      setMessage(
        newState
          ? "ON command sent"
          : "OFF command sent"
      );
    }


    setChanging(false);
  }


  // =======================================================
  // INITIAL LOAD
  // =======================================================

  useEffect(() => {

    loadDevice();


    // =====================================================
    // REALTIME
    // =====================================================

    const channel =
      supabase
        .channel(
          `device-${DEVICE_KEY}`
        )
        .on(
          "postgres_changes",
          {
            event: "*",

            schema: "public",

            table: "devices",

            filter:
              `device_key=eq.${DEVICE_KEY}`,
          },

          (payload) => {

            if (
              payload.new
            ) {

              setDevice(
                payload.new as Device
              );
            }
          }
        )
        .subscribe(
          (status) => {

            console.log(
              "Realtime status:",
              status
            );
          }
        );


    return () => {

      supabase.removeChannel(
        channel
      );
    };

  }, []);


  // =======================================================
  // UPDATE CURRENT TIME
  //
  // This allows the UI to automatically turn the device
  // from ONLINE to OFFLINE when last_seen becomes old.
  // =======================================================

  useEffect(() => {

    const timer =
      setInterval(() => {

        setNow(
          Date.now()
        );

      }, 1000);


    return () => {

      clearInterval(
        timer
      );

    };

  }, []);


  // =======================================================
  // CALCULATE ONLINE STATUS
  // =======================================================

  function isDeviceOnline() {

    if (
      !device ||
      !device.last_seen
    ) {

      return false;
    }


    const lastSeen =
      new Date(
        device.last_seen
      ).getTime();


    const difference =
      now - lastSeen;


    return (
      difference <
      ONLINE_TIMEOUT
    );
  }


  // =======================================================
  // LAST SEEN TEXT
  // =======================================================

  function getLastSeenText() {

    if (!device?.last_seen) {

      return "Never";
    }


    const lastSeen =
      new Date(
        device.last_seen
      ).getTime();


    const seconds =
      Math.floor(
        (now - lastSeen) / 1000
      );


    if (seconds < 0) {

      return "Just now";
    }


    if (seconds < 5) {

      return "Just now";
    }


    if (seconds < 60) {

      return `${seconds} seconds ago`;
    }


    const minutes =
      Math.floor(
        seconds / 60
      );


    if (minutes < 60) {

      return `${minutes} minute${
        minutes !== 1
          ? "s"
          : ""
      } ago`;
    }


    return new Date(
      device.last_seen
    ).toLocaleString();
  }


  // =======================================================
  // LOADING
  // =======================================================

  if (loading) {

    return (

      <main className="page">

        <div className="loading">

          <div className="spinner" />

          <p>
            Connecting to ESP32...
          </p>

        </div>


        <style jsx>
          {styles}
        </style>

      </main>
    );
  }


  // =======================================================
  // DEVICE ONLINE STATUS
  // =======================================================

  const deviceOnline =
    isDeviceOnline();


  // =======================================================
  // MAIN
  // =======================================================

  return (

    <main className="page">

      <div className="container">


        {/* =================================================
            HEADER
        ================================================= */}

        <header className="header">

          <div>

            <div className="brand">
              ESP32 Control
            </div>

            <div className="subtitle">
              Remote IoT Dashboard
            </div>

          </div>


          <div
            className={
              deviceOnline
                ? "connection online"
                : "connection offline"
            }
          >

            <span className="statusDot" />

            {deviceOnline
              ? "Online"
              : "Offline"}

          </div>

        </header>


        {/* =================================================
            DEVICE CARD
        ================================================= */}

        {device ? (

          <section className="deviceCard">


            {/* DEVICE HEADER */}

            <div className="deviceTop">

              <div>

                <div className="deviceName">

                  {device.device_name}

                </div>


                <div className="deviceId">

                  Device ID:{" "}

                  {device.device_key}

                </div>

              </div>


              <div
                className={
                  device.state
                    ? "stateBadge onBadge"
                    : "stateBadge offBadge"
                }
              >

                {device.state
                  ? "ON"
                  : "OFF"}

              </div>

            </div>


            {/* CONNECTION STATUS */}

            <div
              className={
                deviceOnline
                  ? "connectionBox connectionBoxOnline"
                  : "connectionBox connectionBoxOffline"
              }
            >

              <div className="connectionIcon">

                {deviceOnline
                  ? "●"
                  : "●"}

              </div>


              <div>

                <div className="connectionTitle">

                  {deviceOnline
                    ? "ESP32 is Online"
                    : "ESP32 is Offline"}

                </div>


                <div className="connectionText">

                  Last seen:{" "}

                  {getLastSeenText()}

                </div>

              </div>

            </div>


            {/* CURRENT STATE */}

            <div className="statusBox">

              <div className="statusLabel">

                Current Device State

              </div>


              <div
                className={
                  device.state
                    ? "statusValue onText"
                    : "statusValue offText"
                }
              >

                {device.state
                  ? "Device is ON"
                  : "Device is OFF"}

              </div>

            </div>


            {/* CONTROLS */}

            <div className="controls">


              <button
                type="button"
                className="onButton"
                disabled={
                  changing ||
                  !deviceOnline ||
                  device.state
                }
                onClick={() =>
                  setDeviceState(true)
                }
              >

                {changing &&
                !device.state

                  ? "Sending..."

                  : "TURN ON"}

              </button>


              <button
                type="button"
                className="offButton"
                disabled={
                  changing ||
                  !deviceOnline ||
                  !device.state
                }
                onClick={() =>
                  setDeviceState(false)
                }
              >

                {changing &&
                device.state

                  ? "Sending..."

                  : "TURN OFF"}

              </button>

            </div>


            {/* OFFLINE WARNING */}

            {!deviceOnline && (

              <div className="offlineWarning">

                ESP32 is currently offline.
                <br />

                Connect the device to Wi-Fi
                before sending commands.

              </div>

            )}


            {/* MESSAGE */}

            {message && (

              <div className="message">

                {message}

              </div>

            )}


            {/* LAST UPDATE */}

            <div className="lastUpdate">

              <span>
                Last command update:
              </span>

              <span>

                {device.updated_at
                  ? new Date(
                      device.updated_at
                    ).toLocaleString()
                  : "Never"}

              </span>

            </div>


          </section>

        ) : (

          <section className="notFound">

            <h2>
              Device not found
            </h2>

            <p>
              Device
              <strong>
                {" "}esp32-001
              </strong>
              {" "}
              doesn't exist in Supabase.
            </p>

          </section>

        )}


        {/* =================================================
            INFORMATION CARDS
        ================================================= */}

        <section className="infoGrid">


          <div className="infoCard">

            <div className="infoTitle">
              DEVICE
            </div>

            <div className="infoValue">
              ESP32
            </div>

          </div>


          <div className="infoCard">

            <div className="infoTitle">
              CONNECTION
            </div>

            <div className="infoValue">

              {deviceOnline
                ? "Online"
                : "Offline"}

            </div>

          </div>


          <div className="infoCard">

            <div className="infoTitle">
              CONTROL
            </div>

            <div className="infoValue">
              Worldwide
            </div>

          </div>


        </section>


        {/* FOOTER */}

        <footer>

          ESP32 IoT Control Dashboard

        </footer>


      </div>


      <style jsx>
        {styles}
      </style>

    </main>
  );
}


// =========================================================
// CSS
// =========================================================

const styles = `

* {
  box-sizing: border-box;
}


body {
  margin: 0;
}


/* PAGE */

.page {

  min-height: 100vh;

  background:
    radial-gradient(
      circle at top,
      #1f2937 0%,
      #0b0f14 40%,
      #05070a 100%
    );

  color: white;

  font-family:
    Arial,
    Helvetica,
    sans-serif;

  padding: 20px;

}


/* CONTAINER */

.container {

  width: 100%;

  max-width: 1000px;

  margin: auto;

}


/* HEADER */

.header {

  display: flex;

  justify-content:
    space-between;

  align-items: center;

  gap: 20px;

  padding:
    20px 0 30px;

}


.brand {

  font-size: 30px;

  font-weight: 800;

  letter-spacing: -1px;

}


.subtitle {

  color: #9ca3af;

  margin-top: 5px;

  font-size: 14px;

}


/* CONNECTION */

.connection {

  display: flex;

  align-items: center;

  gap: 8px;

  padding:
    9px 15px;

  border-radius: 50px;

  font-size: 14px;

  font-weight: 600;

}


.connection.online {

  background:
    rgba(34,197,94,0.12);

  border:
    1px solid
    rgba(34,197,94,0.25);

  color: #4ade80;

}


.connection.offline {

  background:
    rgba(239,68,68,0.12);

  border:
    1px solid
    rgba(239,68,68,0.25);

  color: #f87171;

}


.statusDot {

  width: 8px;

  height: 8px;

  border-radius: 50%;

  background: currentColor;

}


/* DEVICE CARD */

.deviceCard {

  background:
    rgba(17,24,39,0.85);

  border:
    1px solid
    rgba(255,255,255,0.08);

  border-radius: 24px;

  padding: 28px;

  box-shadow:
    0 25px 70px
    rgba(0,0,0,0.4);

  backdrop-filter:
    blur(15px);

}


/* DEVICE TOP */

.deviceTop {

  display: flex;

  align-items: center;

  justify-content:
    space-between;

  gap: 20px;

  margin-bottom: 25px;

}


.deviceName {

  font-size: 24px;

  font-weight: 700;

}


.deviceId {

  color: #6b7280;

  font-size: 13px;

  margin-top: 6px;

}


/* STATE */

.stateBadge {

  padding:
    9px 18px;

  border-radius: 50px;

  font-size: 13px;

  font-weight: 700;

}


.onBadge {

  background:
    rgba(34,197,94,0.15);

  color: #4ade80;

  border:
    1px solid
    rgba(34,197,94,0.3);

}


.offBadge {

  background:
    rgba(239,68,68,0.12);

  color: #f87171;

  border:
    1px solid
    rgba(239,68,68,0.25);

}


/* CONNECTION BOX */

.connectionBox {

  display: flex;

  align-items: center;

  gap: 15px;

  padding: 18px;

  border-radius: 16px;

  margin-bottom: 20px;

}


.connectionBoxOnline {

  background:
    rgba(34,197,94,0.08);

  border:
    1px solid
    rgba(34,197,94,0.15);

}


.connectionBoxOffline {

  background:
    rgba(239,68,68,0.08);

  border:
    1px solid
    rgba(239,68,68,0.15);

}


.connectionIcon {

  font-size: 22px;

}


.connectionBoxOnline
.connectionIcon {

  color: #22c55e;

}


.connectionBoxOffline
.connectionIcon {

  color: #ef4444;

}


.connectionTitle {

  font-size: 15px;

  font-weight: 700;

}


.connectionText {

  margin-top: 4px;

  color: #9ca3af;

  font-size: 12px;

}


/* STATUS */

.statusBox {

  text-align: center;

  padding:
    35px 20px;

  border-radius: 18px;

  background: #080b10;

  border:
    1px solid
    rgba(255,255,255,0.06);

}


.statusLabel {

  color: #6b7280;

  font-size: 13px;

  margin-bottom: 10px;

}


.statusValue {

  font-size: 28px;

  font-weight: 800;

}


.onText {

  color: #4ade80;

}


.offText {

  color: #f87171;

}


/* CONTROLS */

.controls {

  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 15px;

  margin-top: 25px;

}


.controls button {

  min-height: 60px;

  border: none;

  border-radius: 15px;

  font-size: 16px;

  font-weight: 800;

  cursor: pointer;

  transition:
    transform 0.15s,
    opacity 0.15s;

}


.controls button:hover {

  transform:
    translateY(-2px);

}


.controls button:active {

  transform:
    scale(0.98);

}


.controls button:disabled {

  opacity: 0.3;

  cursor: not-allowed;

  transform: none;

}


.onButton {

  background: #22c55e;

  color: #03130a;

  box-shadow:
    0 10px 30px
    rgba(34,197,94,0.2);

}


.offButton {

  background: #ef4444;

  color: white;

  box-shadow:
    0 10px 30px
    rgba(239,68,68,0.2);

}


/* OFFLINE */

.offlineWarning {

  text-align: center;

  margin-top: 20px;

  padding: 14px;

  border-radius: 12px;

  background:
    rgba(239,68,68,0.08);

  border:
    1px solid
    rgba(239,68,68,0.15);

  color: #fca5a5;

  font-size: 13px;

  line-height: 1.6;

}


/* MESSAGE */

.message {

  text-align: center;

  margin-top: 20px;

  padding: 12px;

  border-radius: 12px;

  background:
    rgba(255,255,255,0.04);

  color: #d1d5db;

  font-size: 14px;

}


/* LAST UPDATE */

.lastUpdate {

  display: flex;

  justify-content:
    center;

  gap: 5px;

  color: #6b7280;

  font-size: 12px;

  margin-top: 20px;

}


.lastUpdate span:last-child {

  color: #9ca3af;

}


/* INFO */

.infoGrid {

  display: grid;

  grid-template-columns:
    repeat(3, 1fr);

  gap: 15px;

  margin-top: 20px;

}


.infoCard {

  background:
    rgba(17,24,39,0.75);

  border:
    1px solid
    rgba(255,255,255,0.07);

  border-radius: 18px;

  padding: 20px;

}


.infoTitle {

  color: #6b7280;

  font-size: 11px;

  margin-bottom: 7px;

  letter-spacing: 1px;

}


.infoValue {

  font-size: 17px;

  font-weight: 700;

}


/* NOT FOUND */

.notFound {

  background:
    rgba(17,24,39,0.85);

  border:
    1px solid
    rgba(239,68,68,0.2);

  border-radius: 20px;

  padding: 40px;

  text-align: center;

}


.notFound h2 {

  margin: 0 0 10px;

}


.notFound p {

  color: #9ca3af;

}


/* FOOTER */

footer {

  text-align: center;

  color: #4b5563;

  font-size: 12px;

  padding:
    30px 0 10px;

}


/* LOADING */

.loading {

  min-height: 90vh;

  display: flex;

  flex-direction: column;

  align-items: center;

  justify-content: center;

  color: #9ca3af;

}


.spinner {

  width: 35px;

  height: 35px;

  border:
    3px solid
    rgba(255,255,255,0.1);

  border-top-color:
    #22c55e;

  border-radius: 50%;

  animation:
    spin 0.8s linear infinite;

  margin-bottom: 15px;

}


@keyframes spin {

  to {

    transform:
      rotate(360deg);

  }

}


/* MOBILE */

@media (max-width: 600px) {

  .page {

    padding: 12px;

  }


  .header {

    padding:
      15px 5px 20px;

    align-items:
      flex-start;

  }


  .brand {

    font-size: 24px;

  }


  .subtitle {

    font-size: 12px;

  }


  .connection {

    font-size: 12px;

    padding:
      7px 10px;

  }


  .deviceCard {

    padding: 20px;

    border-radius: 20px;

  }


  .deviceTop {

    margin-bottom: 20px;

  }


  .deviceName {

    font-size: 20px;

  }


  .stateBadge {

    padding:
      7px 12px;

    font-size: 11px;

  }


  .connectionBox {

    padding: 15px;

  }


  .statusBox {

    padding:
      30px 15px;

  }


  .statusValue {

    font-size: 23px;

  }


  .controls {

    grid-template-columns:
      1fr;

    gap: 12px;

  }


  .controls button {

    min-height: 58px;

  }


  .infoGrid {

    grid-template-columns:
      1fr;

  }


  .lastUpdate {

    flex-direction:
      column;

    align-items:
      center;

  }

}

`;