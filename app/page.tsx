"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/************************************************************
 * SUPABASE
 ************************************************************/

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/*
 * Internal device key.
 * This is NOT displayed in the UI.
 */
const DEVICE_KEY = "esp32-001";

/*
 * ESP32 heartbeat should ideally be around 5 seconds.
 *
 * The browser considers the device disconnected when
 * the last heartbeat is older than this value.
 */
const ONLINE_TIMEOUT = 8000;

/************************************************************
 * SUPABASE CLIENT
 ************************************************************/

const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

/************************************************************
 * DEVICE TYPE
 ************************************************************/

type Device = {
  id: string;
  device_name: string;
  device_key: string;
  state: boolean;
  online: boolean;
  last_seen: string | null;
  updated_at: string;
};

/************************************************************
 * HOME PAGE
 ************************************************************/

export default function Home() {
  const [device, setDevice] = useState<Device | null>(null);

  const [loading, setLoading] = useState(true);

  const [changing, setChanging] = useState(false);

  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const [error, setError] = useState<string | null>(null);

  /*
   * Local clock.
   *
   * This does NOT make API requests.
   * It is only used to determine whether last_seen
   * has become stale.
   */
  const [now, setNow] = useState(Date.now());

  /************************************************************
   * LOCAL CLOCK
   *
   * No network request.
   ************************************************************/

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  /************************************************************
   * GET DEVICE
   *
   * Only used for the initial state.
   *
   * We do NOT continuously poll the API.
   ************************************************************/

  async function loadDevice() {
    try {
      const {
        data,
        error: fetchError,
      } = await supabase
        .from("devices")
        .select("*")
        .eq("device_key", DEVICE_KEY)
        .single();

      if (fetchError) {
        console.error("DEVICE FETCH ERROR:", fetchError);

        setError(fetchError.message);
        return;
      }

      if (data) {
        setDevice(data as Device);
      }

      setError(null);
    } catch (err) {
      console.error("DEVICE LOAD ERROR:", err);

      setError("Unable to load device.");
    } finally {
      setLoading(false);
    }
  }

  /************************************************************
   * CHANGE LIGHT
   *
   * true  = ON
   * false = OFF
   *
   * There is NO inversion here.
   ************************************************************/

  async function changeLight(newState: boolean) {
    if (!device) {
      return;
    }

    if (!deviceAvailable) {
      setError("Device is disconnected.");
      return;
    }

    if (changing) {
      return;
    }

    setChanging(true);
    setError(null);

    console.log("================================");
    console.log("LIGHT COMMAND");
    console.log("Requested state:", newState);
    console.log("Requested:", newState ? "ON" : "OFF");
    console.log("================================");

    try {
      const {
        data,
        error: updateError,
      } = await supabase
        .from("devices")
        .update({
          state: newState,
          updated_at: new Date().toISOString(),
        })
        .eq("device_key", DEVICE_KEY)
        .select("*")
        .single();

      if (updateError) {
        console.error("LIGHT UPDATE ERROR:", updateError);

        setError(updateError.message);
        return;
      }

      console.log("Supabase updated:");
      console.log(data);

      if (data) {
        setDevice(data as Device);
      }

      console.log("Database state:", data?.state);
    } catch (err) {
      console.error("LIGHT COMMAND ERROR:", err);

      setError("Unable to control the light.");
    } finally {
      setChanging(false);
    }
  }

  /************************************************************
   * REALTIME
   *
   * Realtime is established immediately.
   *
   * No repeated REST polling.
   ************************************************************/

  useEffect(() => {
    let mounted = true;

    /*
     * Load current state once.
     */
    loadDevice();

    /*
     * Create Realtime channel immediately.
     */
    const channel = supabase.channel(`smart-light-${DEVICE_KEY}`);

    /**********************************************************
     * DATABASE CHANGES
     **********************************************************/

    channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "devices",
        filter: `device_key=eq.${DEVICE_KEY}`,
      },
      (payload) => {
        if (!mounted) {
          return;
        }

        console.log("================================");
        console.log("REALTIME DATABASE UPDATE");
        console.log("================================");

        console.log("Previous:", payload.old);
        console.log("New:", payload.new);

        const updatedDevice = payload.new as Device;

        /*
         * Direct database value.
         *
         * true  = ON
         * false = OFF
         */
        setDevice(updatedDevice);
      }
    );

    /**********************************************************
     * REALTIME CONNECTION STATUS
     **********************************************************/

    channel.subscribe((status) => {
      if (!mounted) {
        return;
      }

      console.log("Realtime status:", status);

      if (status === "SUBSCRIBED") {
        console.log("Supabase Realtime connected");

        setRealtimeConnected(true);
      } else {
        console.log("Supabase Realtime disconnected");

        /*
         * This immediately tells the UI that the
         * realtime connection itself is unavailable.
         */
        setRealtimeConnected(false);
      }
    });

    /**********************************************************
     * CLEANUP
     **********************************************************/

    return () => {
      mounted = false;

      supabase.removeChannel(channel);
    };
  }, []);

  /************************************************************
   * DEVICE ONLINE STATUS
   *
   * Two things are checked:
   *
   * 1. Database says online = true
   * 2. last_seen is still fresh
   *
   * Realtime connection is also required.
   *
   * IMPORTANT:
   * This does NOT make network requests.
   ************************************************************/

  const deviceAvailable = useMemo(() => {
    if (!device) {
      return false;
    }

    /*
     * If Realtime itself is disconnected,
     * immediately treat the device as unavailable.
     */
    if (!realtimeConnected) {
      return false;
    }

    /*
     * ESP32 must report online.
     */
    if (device.online !== true) {
      return false;
    }

    /*
     * No heartbeat timestamp = offline.
     */
    if (!device.last_seen) {
      return false;
    }

    const lastSeenTime = new Date(
      device.last_seen
    ).getTime();

    /*
     * Invalid timestamp = offline.
     */
    if (Number.isNaN(lastSeenTime)) {
      return false;
    }

    /*
     * Heartbeat is too old.
     */
    const heartbeatAge = now - lastSeenTime;

    return heartbeatAge < ONLINE_TIMEOUT;
  }, [
    device,
    realtimeConnected,
    now,
  ]);

  /************************************************************
   * LIGHT STATE
   *
   * IMPORTANT:
   *
   * If the device is disconnected, the UI always shows
   * the light as OFF.
   ************************************************************/

  const lightIsOn =
    deviceAvailable &&
    device?.state === true;

  /************************************************************
   * LOADING
   ************************************************************/

  if (loading) {
    return (
      <main className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />

          <p className="text-white/50 text-sm">
            Connecting to smart light...
          </p>
        </div>
      </main>
    );
  }

  /************************************************************
   * PAGE
   ************************************************************/

  return (
    <main className="min-h-screen bg-[#050505] text-white overflow-hidden relative">
      {/* =====================================================
          BACKGROUND
      ===================================================== */}

      <div className="fixed inset-0 pointer-events-none">
        <div
          className={`
            absolute
            left-1/2
            top-1/2
            -translate-x-1/2
            -translate-y-1/2
            w-[420px]
            h-[420px]
            sm:w-[600px]
            sm:h-[600px]
            rounded-full
            blur-[140px]
            transition-all
            duration-500
            ${
              lightIsOn
                ? "bg-yellow-400/[0.12]"
                : "bg-white/[0.015]"
            }
          `}
        />
      </div>

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="relative z-20 max-w-5xl mx-auto px-5 sm:px-8 pt-6 sm:pt-8">
        <div className="flex items-center justify-between">
          {/* LEFT */}

          <div>
            <p className="text-[10px] sm:text-xs uppercase tracking-[0.25em] text-white/35">
              Smart Home
            </p>

            <h1 className="text-lg sm:text-2xl font-semibold mt-1">
              Smart Light
            </h1>
          </div>

          {/* CONNECTION */}

          <div
            className={`
              flex
              items-center
              gap-2
              rounded-full
              px-3
              py-2
              border
              transition-all
              duration-300
              ${
                deviceAvailable
                  ? "border-green-400/20 bg-green-400/[0.06]"
                  : "border-red-400/20 bg-red-400/[0.06]"
              }
            `}
          >
            <span
              className={`
                w-2
                h-2
                rounded-full
                transition-all
                duration-300
                ${
                  deviceAvailable
                    ? "bg-green-400 shadow-[0_0_12px_rgba(74,222,128,0.9)]"
                    : "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.5)]"
                }
              `}
            />

            <span
              className={`
                text-xs
                ${
                  deviceAvailable
                    ? "text-green-300/80"
                    : "text-red-300/80"
                }
              `}
            >
              {deviceAvailable
                ? "Connected"
                : "Disconnected"}
            </span>
          </div>
        </div>
      </header>

      {/* =====================================================
          DISCONNECTED WARNING
      ===================================================== */}

      {!deviceAvailable && (
        <div className="relative z-30 px-5 sm:px-8 mt-6">
          <div className="max-w-md mx-auto">
            <div className="rounded-2xl border border-red-400/20 bg-red-500/[0.06] backdrop-blur-xl px-5 py-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.7)]" />

                <p className="text-sm font-medium text-red-300">
                  Device Disconnected
                </p>
              </div>

              <p className="text-xs text-white/45">
                Please check the connection.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          MAIN
      ===================================================== */}

      <section className="relative z-10 max-w-5xl mx-auto px-5 sm:px-8 py-10 sm:py-16">
        <div
          className={`
            max-w-2xl
            mx-auto
            transition-all
            duration-300
            ${
              !deviceAvailable
                ? "pointer-events-none blur-[4px] opacity-35"
                : "opacity-100"
            }
          `}
        >
          {/* =================================================
              LIGHT
          ================================================= */}

          <div className="flex justify-center items-center">
            <div className="relative w-[250px] h-[310px] sm:w-[320px] sm:h-[380px] flex items-center justify-center">
              {/* OUTER GLOW */}

              <div
                className={`
                  absolute
                  w-[190px]
                  h-[190px]
                  sm:w-[250px]
                  sm:h-[250px]
                  rounded-full
                  blur-[70px]
                  transition-all
                  duration-700
                  ${
                    lightIsOn
                      ? "bg-yellow-400/30 opacity-100"
                      : "bg-yellow-400/0 opacity-0"
                  }
                `}
              />

              {/* LIGHT RINGS */}

              <div
                className={`
                  absolute
                  w-[180px]
                  h-[180px]
                  sm:w-[235px]
                  sm:h-[235px]
                  rounded-full
                  border
                  transition-all
                  duration-700
                  ${
                    lightIsOn
                      ? "border-yellow-300/20 scale-100 opacity-100"
                      : "border-white/[0.03] scale-90 opacity-50"
                  }
                `}
              />

              <div
                className={`
                  absolute
                  w-[220px]
                  h-[220px]
                  sm:w-[285px]
                  sm:h-[285px]
                  rounded-full
                  border
                  transition-all
                  duration-700
                  ${
                    lightIsOn
                      ? "border-yellow-300/10 scale-100 opacity-100"
                      : "border-white/[0.02] scale-90 opacity-40"
                  }
                `}
              />

              {/* ORBITING DOT */}

              {lightIsOn && (
                <div className="absolute inset-0 animate-[spin_8s_linear_infinite]">
                  <div className="absolute left-1/2 -translate-x-1/2 top-[24px] sm:top-[32px]">
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-300 shadow-[0_0_14px_rgba(253,224,71,1)]" />
                  </div>
                </div>
              )}

              {/* BULB */}

              <div
                className={`
                  relative
                  z-10
                  flex
                  flex-col
                  items-center
                  transition-all
                  duration-700
                  ${
                    lightIsOn
                      ? "animate-[bulbFloat_4s_ease-in-out_infinite]"
                      : ""
                  }
                `}
              >
                {/* GLASS */}

                <div
                  className={`
                    relative
                    w-[120px]
                    h-[145px]
                    sm:w-[155px]
                    sm:h-[185px]
                    rounded-[50%_50%_46%_46%]
                    transition-all
                    duration-700
                    ${
                      lightIsOn
                        ? `
                          bg-gradient-to-b
                          from-yellow-100
                          via-yellow-300
                          to-yellow-500
                          shadow-[0_0_35px_rgba(250,204,21,0.65),0_0_90px_rgba(250,204,21,0.35)]
                        `
                        : `
                          bg-gradient-to-b
                          from-white/[0.08]
                          via-white/[0.045]
                          to-white/[0.02]
                          border
                          border-white/[0.10]
                        `
                    }
                  `}
                >
                  {/* INNER GLOW */}

                  <div
                    className={`
                      absolute
                      inset-[10%]
                      rounded-full
                      blur-[18px]
                      transition-all
                      duration-700
                      ${
                        lightIsOn
                          ? "bg-white/50 opacity-100"
                          : "bg-white/0 opacity-0"
                      }
                    `}
                  />

                  {/* HIGHLIGHT */}

                  <div
                    className={`
                      absolute
                      top-[16%]
                      left-[20%]
                      w-[25%]
                      h-[38%]
                      rounded-full
                      rotate-[25deg]
                      blur-[3px]
                      transition-all
                      duration-700
                      ${
                        lightIsOn
                          ? "bg-white/70 opacity-100"
                          : "bg-white/0 opacity-0"
                      }
                    `}
                  />

                  {/* FILAMENT */}

                  <div
                    className={`
                      absolute
                      left-1/2
                      top-[42%]
                      -translate-x-1/2
                      w-[36px]
                      sm:w-[46px]
                      h-[48px]
                      sm:h-[60px]
                      transition-all
                      duration-700
                      ${
                        lightIsOn
                          ? "opacity-100"
                          : "opacity-20"
                      }
                    `}
                  >
                    <div
                      className={`
                        absolute
                        left-1/2
                        top-0
                        -translate-x-1/2
                        w-[2px]
                        h-full
                        ${
                          lightIsOn
                            ? "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.9)]"
                            : "bg-white/30"
                        }
                      `}
                    />

                    <div
                      className={`
                        absolute
                        left-[5px]
                        right-[5px]
                        top-[12px]
                        h-[28px]
                        sm:h-[36px]
                        border-x-2
                        rounded-full
                        ${
                          lightIsOn
                            ? "border-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)]"
                            : "border-white/20"
                        }
                      `}
                    />
                  </div>
                </div>

                {/* BULB NECK */}

                <div
                  className={`
                    -mt-[2px]
                    w-[58px]
                    sm:w-[72px]
                    h-[20px]
                    sm:h-[24px]
                    rounded-b-xl
                    transition-all
                    duration-700
                    ${
                      lightIsOn
                        ? "bg-gradient-to-b from-yellow-400 to-yellow-500 shadow-[0_0_20px_rgba(250,204,21,0.45)]"
                        : "bg-white/[0.08] border border-white/[0.08]"
                    }
                  `}
                />

                {/* METAL BASE */}

                <div className="relative -mt-[1px] w-[60px] sm:w-[75px]">
                  <div
                    className={`
                      h-[9px]
                      sm:h-[11px]
                      rounded-sm
                      transition-all
                      duration-700
                      ${
                        lightIsOn
                          ? "bg-gradient-to-r from-zinc-500 via-zinc-200 to-zinc-500"
                          : "bg-gradient-to-r from-zinc-800 via-zinc-600 to-zinc-800"
                      }
                    `}
                  />

                  <div
                    className={`
                      h-[8px]
                      sm:h-[10px]
                      rounded-sm
                      border-t
                      transition-all
                      duration-700
                      ${
                        lightIsOn
                          ? "bg-gradient-to-r from-zinc-600 via-zinc-300 to-zinc-600 border-zinc-200/50"
                          : "bg-gradient-to-r from-zinc-900 via-zinc-700 to-zinc-900 border-white/10"
                      }
                    `}
                  />

                  <div
                    className={`
                      h-[8px]
                      sm:h-[10px]
                      rounded-sm
                      border-t
                      transition-all
                      duration-700
                      ${
                        lightIsOn
                          ? "bg-gradient-to-r from-zinc-500 via-zinc-200 to-zinc-500 border-zinc-200/50"
                          : "bg-gradient-to-r from-zinc-900 via-zinc-700 to-zinc-900 border-white/10"
                      }
                    `}
                  />

                  <div
                    className={`
                      h-[9px]
                      sm:h-[11px]
                      rounded-b-md
                      transition-all
                      duration-700
                      ${
                        lightIsOn
                          ? "bg-zinc-500"
                          : "bg-zinc-800"
                      }
                    `}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* =================================================
              BUTTONS
          ================================================= */}

          <div className="mt-2 sm:mt-4 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            {/* ON */}

            <button
              type="button"
              onClick={() => changeLight(true)}
              disabled={!deviceAvailable || changing}
              className={`
                w-full
                sm:w-[150px]
                h-12
                rounded-2xl
                font-medium
                text-sm
                transition-all
                duration-200
                border
                ${
                  lightIsOn
                    ? `
                      bg-yellow-400
                      text-black
                      border-yellow-300
                      shadow-[0_8px_30px_rgba(250,204,21,0.25)]
                    `
                    : `
                      bg-white/[0.04]
                      text-white/70
                      border-white/[0.10]
                      hover:bg-white/[0.07]
                      hover:text-white
                    `
                }
                disabled:cursor-not-allowed
              `}
            >
              {changing && lightIsOn
                ? "Turning ON..."
                : "TURN ON"}
            </button>

            {/* OFF */}

            <button
              type="button"
              onClick={() => changeLight(false)}
              disabled={!deviceAvailable || changing}
              className={`
                w-full
                sm:w-[150px]
                h-12
                rounded-2xl
                font-medium
                text-sm
                transition-all
                duration-200
                border
                ${
                  !lightIsOn
                    ? `
                      bg-white/[0.08]
                      text-white
                      border-white/[0.15]
                    `
                    : `
                      bg-white/[0.04]
                      text-white/60
                      border-white/[0.10]
                      hover:bg-white/[0.07]
                      hover:text-white
                    `
                }
                disabled:cursor-not-allowed
              `}
            >
              {changing && !lightIsOn
                ? "Turning OFF..."
                : "TURN OFF"}
            </button>
          </div>

          {/* =================================================
              ERROR
          ================================================= */}

          {error && deviceAvailable && (
            <p className="text-center text-xs text-red-400/80 mt-4">
              {error}
            </p>
          )}
        </div>
      </section>

      {/* =====================================================
          ANIMATIONS
      ===================================================== */}

      <style jsx global>{`
        @keyframes bulbFloat {
          0%,
          100% {
            transform: translateY(0px);
          }

          50% {
            transform: translateY(-7px);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>
    </main>
  );
}