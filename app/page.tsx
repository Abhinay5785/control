"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

interface Device {
  id: string;
  device_name: string;
  device_key: string;
  state: boolean;
  updated_at: string;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
  );
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const DEVICE_KEY = "esp32-001";

export default function Home() {
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [changing, setChanging] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");

  // ---------------------------------------------------------
  // LOAD DEVICE
  // ---------------------------------------------------------

  async function loadDevice(): Promise<void> {
    setLoading(true);

    const { data, error } = await supabase
      .from("devices")
      .select("*")
      .eq("device_key", DEVICE_KEY)
      .single();

    if (error) {
      console.error("LOAD DEVICE ERROR:", error);
      setMessage(`Unable to load device: ${error.message}`);
    } else if (data) {
      setDevice(data as Device);
    }

    setLoading(false);
  }

  // ---------------------------------------------------------
  // CHANGE DEVICE STATE
  // ---------------------------------------------------------

  async function setDeviceState(newState: boolean): Promise<void> {
    if (!device || changing) {
      return;
    }

    setChanging(true);
    setMessage("");

    const { data, error } = await supabase
      .from("devices")
      .update({
        state: newState,
        updated_at: new Date().toISOString(),
      })
      .eq("device_key", DEVICE_KEY)
      .select()
      .single();

    if (error) {
      console.error("UPDATE DEVICE ERROR:", error);
      setMessage(`Failed to update device: ${error.message}`);
    } else if (data) {
      setDevice(data as Device);

      if (newState) {
        setMessage("Device turned ON");
      } else {
        setMessage("Device turned OFF");
      }
    }

    setChanging(false);
  }

  // ---------------------------------------------------------
  // INITIAL LOAD + REALTIME
  // ---------------------------------------------------------

  useEffect(() => {
    loadDevice();

    const channel = supabase
      .channel(`device-${DEVICE_KEY}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "devices",
          filter: `device_key=eq.${DEVICE_KEY}`,
        },
        (payload) => {
          const updatedDevice = payload.new as Device;

          setDevice(updatedDevice);
        }
      )
      .subscribe((status) => {
        console.log("Realtime status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ---------------------------------------------------------
  // LOADING
  // ---------------------------------------------------------

  if (loading) {
    return (
      <main className="page">
        <div className="loading">
          <div className="spinner" />
          <p>Connecting to ESP32...</p>
        </div>

        <style jsx>{styles}</style>
      </main>
    );
  }

  // ---------------------------------------------------------
  // MAIN PAGE
  // ---------------------------------------------------------

  return (
    <main className="page">
      <div className="container">

        {/* HEADER */}

        <header className="header">

          <div>
            <div className="brand">
              ESP32 Control
            </div>

            <div className="subtitle">
              Remote IoT Dashboard
            </div>
          </div>

          <div className="connection">
            <span className="onlineDot" />
            Cloud Connected
          </div>

        </header>


        {/* DEVICE CARD */}

        <section className="deviceCard">

          <div className="deviceTop">

            <div>
              <div className="deviceName">
                {device?.device_name || "ESP32 Device"}
              </div>

              <div className="deviceId">
                Device ID: {DEVICE_KEY}
              </div>
            </div>

            <div
              className={`stateBadge ${
                device?.state ? "onBadge" : "offBadge"
              }`}
            >
              {device?.state ? "ON" : "OFF"}
            </div>

          </div>


          {/* STATUS */}

          <div className="statusBox">

            <div className="statusLabel">
              Current Device State
            </div>

            <div
              className={`statusValue ${
                device?.state ? "onText" : "offText"
              }`}
            >
              {device?.state ? "Device is ON" : "Device is OFF"}
            </div>

          </div>


          {/* BUTTONS */}

          <div className="controls">

            <button
              type="button"
              className="onButton"
              disabled={changing || device?.state === true}
              onClick={() => setDeviceState(true)}
            >
              {changing && device?.state === false
                ? "Turning ON..."
                : "TURN ON"}
            </button>


            <button
              type="button"
              className="offButton"
              disabled={changing || device?.state === false}
              onClick={() => setDeviceState(false)}
            >
              {changing && device?.state === true
                ? "Turning OFF..."
                : "TURN OFF"}
            </button>

          </div>


          {/* MESSAGE */}

          {message && (
            <div className="message">
              {message}
            </div>
          )}


          {/* LAST UPDATED */}

          <div className="lastUpdate">

            <span>Last updated:</span>

            <span>
              {device?.updated_at
                ? new Date(device.updated_at).toLocaleString()
                : "Never"}
            </span>

          </div>

        </section>


        {/* INFORMATION */}

        <section className="infoGrid">

          <div className="infoCard">
            <div className="infoTitle">
              Device
            </div>

            <div className="infoValue">
              ESP32
            </div>
          </div>


          <div className="infoCard">
            <div className="infoTitle">
              Network
            </div>

            <div className="infoValue">
              Wi-Fi
            </div>
          </div>


          <div className="infoCard">
            <div className="infoTitle">
              Control
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


      <style jsx>{styles}</style>
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

.container {
  width: 100%;
  max-width: 1000px;
  margin: auto;
}


/* HEADER */

.header {
  display: flex;

  justify-content: space-between;
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

.connection {
  display: flex;

  align-items: center;

  gap: 8px;

  padding:
    9px 14px;

  border-radius: 50px;

  background:
    rgba(34,197,94,0.12);

  border:
    1px solid
    rgba(34,197,94,0.25);

  color: #4ade80;

  font-size: 14px;
}

.onlineDot {
  width: 8px;
  height: 8px;

  background: #22c55e;

  border-radius: 50%;

  box-shadow:
    0 0 10px
    rgba(34,197,94,0.8);
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

  backdrop-filter: blur(15px);
}

.deviceTop {
  display: flex;

  align-items: center;

  justify-content: space-between;

  gap: 20px;

  margin-bottom: 30px;
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


/* BUTTONS */

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
  transform: translateY(-2px);
}

.controls button:active {
  transform: scale(0.98);
}

.controls button:disabled {
  opacity: 0.35;

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

  justify-content: center;

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

  font-size: 12px;

  margin-bottom: 7px;
}

.infoValue {
  font-size: 17px;

  font-weight: 700;
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

  border-top-color: #22c55e;

  border-radius: 50%;

  animation:
    spin 0.8s linear infinite;

  margin-bottom: 15px;
}

@keyframes spin {

  to {
    transform: rotate(360deg);
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

    align-items: flex-start;
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
    margin-bottom: 22px;
  }

  .deviceName {
    font-size: 20px;
  }

  .stateBadge {
    padding:
      7px 12px;

    font-size: 11px;
  }

  .statusBox {
    padding:
      30px 15px;
  }

  .statusValue {
    font-size: 23px;
  }

  .controls {
    grid-template-columns: 1fr;

    gap: 12px;
  }

  .controls button {
    min-height: 58px;
  }

  .infoGrid {
    grid-template-columns: 1fr;
  }

  .lastUpdate {
    flex-direction: column;

    align-items: center;
  }

}
`;