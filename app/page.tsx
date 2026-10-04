"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createClient,
  SupabaseClient,
} from "@supabase/supabase-js";

/* =========================================================
   CONFIG
========================================================= */

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL!;

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const DEVICE_KEY = "esp32-001";

/*
  ESP32 heartbeat is approximately every 20 seconds.
  We allow 45 seconds before declaring it disconnected.
*/
const ONLINE_TIMEOUT = 45000;

/* =========================================================
   SUPABASE
========================================================= */

const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

/* =========================================================
   TYPES
========================================================= */

type Device = {
  id: string;
  device_name: string;
  device_key: string;
  state: boolean;
  online: boolean;
  last_seen: string | null;
  updated_at: string;
};

/* =========================================================
   HOME
========================================================= */

export default function Home() {
  const [device, setDevice] =
    useState<Device | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [changing, setChanging] =
    useState(false);

  const [realtimeConnected, setRealtimeConnected] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  /*
    Local clock only.
    This does NOT make a network request.
  */
  const [now, setNow] =
    useState(() => Date.now());

  /* =======================================================
     DEVICE AVAILABILITY
  ======================================================= */

  const deviceAvailable = useMemo(() => {
    if (!device?.last_seen) {
      return false;
    }

    const lastSeen =
      new Date(
        device.last_seen
      ).getTime();

    return (
      now - lastSeen <
      ONLINE_TIMEOUT
    );
  }, [device?.last_seen, now]);

  /*
    IMPORTANT:

    If device is unavailable, the UI must NEVER
    show the bulb as ON.
  */

  const lightIsOn =
    deviceAvailable &&
    device?.state === true;

  /* =======================================================
     FAST INITIAL CONNECTION
  ======================================================= */

  useEffect(() => {
    let mounted = true;

    /*
      Create Realtime subscription immediately.

      This starts the persistent WebSocket connection
      without waiting for the REST request.
    */

    const channel =
      supabase.channel(
        `smart-light-${DEVICE_KEY}`
      );

    channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "devices",
        filter:
          `device_key=eq.${DEVICE_KEY}`,
      },
      (payload) => {
        if (!mounted) {
          return;
        }

        console.log(
          "Device update:",
          payload.new
        );

        setDevice(
          payload.new as Device
        );

        setError(null);
      }
    );

    /*
      Subscribe immediately.
    */

    channel.subscribe(
      (status) => {
        if (!mounted) {
          return;
        }

        console.log(
          "Realtime:",
          status
        );

        setRealtimeConnected(
          status === "SUBSCRIBED"
        );
      }
    );

    /*
      Fetch current device state immediately.

      This happens independently from the WebSocket
      connection so the UI doesn't wait unnecessarily.
    */

    async function loadDevice() {
      try {
        const {
          data,
          error: fetchError,
        } = await supabase
          .from("devices")
          .select("*")
          .eq(
            "device_key",
            DEVICE_KEY
          )
          .single();

        if (!mounted) {
          return;
        }

        if (fetchError) {
          console.error(
            "DEVICE FETCH ERROR:",
            fetchError
          );

          setError(
            "Unable to connect to the device."
          );

          setLoading(false);

          return;
        }

        setDevice(
          data as Device
        );

        setError(null);
      } catch (err) {
        console.error(
          "DEVICE LOAD ERROR:",
          err
        );

        if (mounted) {
          setError(
            "Unable to connect to the device."
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadDevice();

    return () => {
      mounted = false;

      supabase.removeChannel(
        channel
      );
    };
  }, []);

  /* =======================================================
     LOCAL CONNECTION CHECK

     Every second we check last_seen locally.

     No API call.
  ======================================================= */

  useEffect(() => {
    const timer =
      window.setInterval(() => {
        setNow(Date.now());
      }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  /* =======================================================
     CHANGE LIGHT
  ======================================================= */

  async function changeLight(
    newState: boolean
  ) {
    /*
      Never send a command if the device is
      unavailable.
    */

    if (!deviceAvailable) {
      setError(
        "Device disconnected. Please check the connection."
      );

      return;
    }

    if (!device || changing) {
      return;
    }

    setChanging(true);
    setError(null);

    try {
      const {
        data,
        error: updateError,
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
        .select("*")
        .single();

      if (updateError) {
        console.error(
          "LIGHT UPDATE ERROR:",
          updateError
        );

        setError(
          "Unable to control the light."
        );

        return;
      }

      if (data) {
        setDevice(
          data as Device
        );
      }
    } catch (err) {
      console.error(
        "LIGHT COMMAND ERROR:",
        err
      );

      setError(
        "Unable to control the light."
      );
    } finally {
      setChanging(false);
    }
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] text-white">

        <div className="flex flex-col items-center">

          <div className="relative h-12 w-12">

            <div className="absolute inset-0 rounded-full border border-white/10" />

            <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-yellow-300" />

            <div className="absolute inset-[14px] rounded-full bg-yellow-300/20 blur-md" />

          </div>

          <p className="mt-4 text-xs text-white/30">
            Connecting...
          </p>

        </div>

      </main>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050505] text-white">

      {/* ===================================================
          BACKGROUND
      =================================================== */}

      <div className="pointer-events-none fixed inset-0">

        {/* Main glow */}

        <div
          className={`absolute left-1/2 top-1/2 h-[450px] w-[450px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[140px] transition-all duration-1000 sm:h-[600px] sm:w-[600px] ${
            lightIsOn
              ? "bg-yellow-400/[0.09]"
              : "bg-transparent"
          }`}
        />

        {/* Subtle background */}

        <div className="absolute left-[-200px] top-[-200px] h-[400px] w-[400px] rounded-full bg-white/[0.015] blur-[120px]" />

        <div className="absolute bottom-[-200px] right-[-200px] h-[400px] w-[400px] rounded-full bg-yellow-500/[0.015] blur-[120px]" />

      </div>

      {/* ===================================================
          DISCONNECTED WARNING
      =================================================== */}

      {!deviceAvailable && (
        <div className="relative z-50 border-b border-red-400/20 bg-red-500/[0.07] backdrop-blur-xl">

          <div className="mx-auto flex min-h-[58px] max-w-2xl items-center justify-center gap-3 px-5 text-center">

            {/* Warning dot */}

            <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-400/10">

              <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-red-400/40" />

              <span className="relative h-2 w-2 rounded-full bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.8)]" />

            </div>

            <div>

              <p className="text-sm font-semibold text-red-300">
                Device Disconnected
              </p>

              <p className="text-[11px] text-red-300/50">
                Please check the connection.
              </p>

            </div>

          </div>

        </div>
      )}

      {/* ===================================================
          MAIN CONTENT

          When disconnected:
          - blur
          - dim
          - no interaction
      =================================================== */}

      <div
        className={`relative z-10 flex min-h-[calc(100vh-58px)] flex-col transition-all duration-700 ${
          !deviceAvailable
            ? "pointer-events-none blur-[4px] opacity-40"
            : ""
        }`}
      >

        {/* =================================================
            TOP BAR
        ================================================= */}

        <header className="flex items-center justify-between px-5 py-5 sm:px-8 sm:py-7">

          {/* Logo / title */}

          <div className="flex items-center gap-3">

            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all duration-500 ${
                lightIsOn
                  ? "border-yellow-300/20 bg-yellow-300/10"
                  : "border-white/10 bg-white/[0.035]"
              }`}
            >

              <div
                className={`h-3 w-3 rounded-full transition-all duration-500 ${
                  lightIsOn
                    ? "bg-yellow-300 shadow-[0_0_14px_rgba(253,224,71,0.9)]"
                    : "bg-white/20"
                }`}
              />

            </div>

            <div>

              <p className="text-[9px] uppercase tracking-[0.3em] text-white/25">
                Smart Home
              </p>

              <p className="text-sm font-medium text-white/75">
                Smart Light
              </p>

            </div>

          </div>

          {/* =================================================
              CONNECTION STATUS
          ================================================= */}

          {deviceAvailable ? (
            <div className="flex items-center gap-2 rounded-full border border-green-400/10 bg-green-400/[0.035] px-3.5 py-2">

              <span className="relative flex h-2 w-2">

                <span className="absolute inset-0 animate-ping rounded-full bg-green-400 opacity-40" />

                <span className="relative h-2 w-2 rounded-full bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.8)]" />

              </span>

              <span className="text-xs font-medium text-green-300/80">
                Connected
              </span>

            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-red-400/20 bg-red-400/[0.06] px-3.5 py-2">

              <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.7)]" />

              <span className="text-xs font-medium text-red-300/80">
                Disconnected
              </span>

            </div>
          )}

        </header>

        {/* =================================================
            CENTER AREA
        ================================================= */}

        <section className="flex flex-1 flex-col items-center justify-center px-5 pb-8 pt-2 sm:pb-12">

          {/* =================================================
              LIGHT ANIMATION
          ================================================= */}

          <div className="relative flex h-[350px] w-[350px] items-center justify-center sm:h-[500px] sm:w-[500px]">

            {/* =================================================
                OUTER GLOW
            ================================================= */}

            <div
              className={`absolute rounded-full transition-all duration-1000 ${
                lightIsOn
                  ? "h-[250px] w-[250px] bg-yellow-300/[0.08] blur-[80px] sm:h-[340px] sm:w-[340px]"
                  : "h-[150px] w-[150px] bg-transparent"
              }`}
            />

            {/* =================================================
                OUTER RING
            ================================================= */}

            <div
              className={`absolute rounded-full border transition-all duration-1000 ${
                lightIsOn
                  ? "h-[270px] w-[270px] border-yellow-200/10 sm:h-[390px] sm:w-[390px]"
                  : "h-[230px] w-[230px] border-white/[0.04] sm:h-[320px] sm:w-[320px]"
              }`}
            />

            {/* =================================================
                ROTATING RING
            ================================================= */}

            {lightIsOn && (
              <>
                <div className="absolute h-[235px] w-[235px] animate-spin-slow rounded-full sm:h-[335px] sm:w-[335px]">

                  <div className="absolute inset-0 rounded-full border border-transparent border-r-yellow-200/10 border-t-yellow-300/50" />

                </div>

                <div className="absolute h-[210px] w-[210px] animate-spin-reverse rounded-full sm:h-[300px] sm:w-[300px]">

                  <div className="absolute inset-0 rounded-full border border-transparent border-b-yellow-200/25 border-l-yellow-300/10" />

                </div>

                {/* Orbiting point */}

                <div className="absolute h-[260px] w-[260px] animate-orbit sm:h-[370px] sm:w-[370px]">

                  <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-yellow-200 shadow-[0_0_15px_rgba(253,224,71,1)]" />

                </div>

              </>
            )}

            {/* =================================================
                BULB
            ================================================= */}

            <div
              className={`relative z-20 ${
                lightIsOn
                  ? "animate-bulb-float"
                  : ""
              }`}
            >

              {/* Glow */}

              {lightIsOn && (
                <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-300/30 blur-[60px] sm:h-52 sm:w-52" />
              )}

              {/* Glass bulb */}

              <div
                className={`relative h-32 w-32 rounded-[44%] transition-all duration-700 sm:h-44 sm:w-44 ${
                  lightIsOn
                    ? "bg-gradient-to-br from-white via-yellow-100 to-yellow-400 shadow-[0_0_35px_rgba(253,224,71,0.8),0_0_90px_rgba(250,204,21,0.3)]"
                    : "border border-white/10 bg-white/[0.025] shadow-[inset_0_0_30px_rgba(255,255,255,0.02)]"
                }`}
              >

                {/* Inner glass */}

                <div
                  className={`absolute inset-[14%] rounded-[45%] transition-all duration-700 ${
                    lightIsOn
                      ? "bg-gradient-to-br from-white/95 via-yellow-100 to-yellow-300"
                      : "bg-white/[0.01]"
                  }`}
                />

                {/* Reflection */}

                {lightIsOn && (
                  <div className="absolute left-[20%] top-[15%] h-[27%] w-[17%] rotate-[-25deg] rounded-full bg-white/80 blur-[6px]" />
                )}

                {/* Filament */}

                {lightIsOn && (
                  <div className="absolute left-1/2 top-[48%] h-12 w-9 -translate-x-1/2">

                    <div className="absolute left-1/2 top-0 h-8 w-[2px] -translate-x-1/2 rounded-full bg-yellow-600/50" />

                    <div className="absolute bottom-0 left-1/2 h-5 w-9 -translate-x-1/2 rounded-full border-b-2 border-yellow-600/40" />

                  </div>
                )}

              </div>

              {/* Neck */}

              <div
                className={`mx-auto h-4 w-12 transition-all duration-700 sm:w-14 ${
                  lightIsOn
                    ? "bg-yellow-500"
                    : "bg-white/10"
                }`}
              />

              {/* Screw */}

              <div
                className={`mx-auto h-10 w-14 rounded-b-xl rounded-t-sm transition-all duration-700 sm:h-12 sm:w-16 ${
                  lightIsOn
                    ? "bg-gradient-to-b from-yellow-500 to-yellow-700 shadow-[0_8px_20px_rgba(234,179,8,0.25)]"
                    : "bg-white/10"
                }`}
              >

                <div className="flex h-full flex-col justify-center gap-1.5 px-2">

                  <div className="h-[2px] rounded-full bg-black/20" />

                  <div className="h-[2px] rounded-full bg-black/20" />

                  <div className="h-[2px] rounded-full bg-black/20" />

                </div>

              </div>

              {/* Bottom */}

              <div
                className={`mx-auto h-3 w-7 rounded-b-lg transition-all duration-700 ${
                  lightIsOn
                    ? "bg-white/50"
                    : "bg-white/10"
                }`}
              />

            </div>

            {/* Bottom glow */}

            {lightIsOn && (
              <div className="absolute bottom-5 h-7 w-36 rounded-full bg-yellow-300/20 blur-2xl" />
            )}

          </div>

          {/* =================================================
              BUTTONS
          ================================================= */}

          <div className="mt-2 flex w-full max-w-md gap-3 sm:mt-5">

            {/* ON */}

            <button
              type="button"
              disabled={
                changing ||
                !deviceAvailable ||
                device?.state === true
              }
              onClick={() =>
                changeLight(true)
              }
              className={`group relative h-14 flex-1 overflow-hidden rounded-2xl text-xs font-semibold tracking-[0.16em] transition-all duration-300 sm:h-16 ${
                lightIsOn
                  ? "bg-yellow-300 text-black shadow-[0_10px_40px_rgba(250,204,21,0.15)]"
                  : "border border-white/10 bg-white/[0.045] text-white/70 hover:border-yellow-300/20 hover:bg-yellow-300/[0.08]"
              } ${
                changing ||
                !deviceAvailable ||
                device?.state === true
                  ? "cursor-not-allowed opacity-45"
                  : "active:scale-[0.97]"
              }`}
            >

              {!(
                changing ||
                !deviceAvailable ||
                device?.state === true
              ) && (
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              )}

              <span className="relative">
                {changing &&
                device?.state !== true
                  ? "..."
                  : "TURN ON"}
              </span>

            </button>

            {/* OFF */}

            <button
              type="button"
              disabled={
                changing ||
                !deviceAvailable ||
                device?.state === false
              }
              onClick={() =>
                changeLight(false)
              }
              className={`group relative h-14 flex-1 overflow-hidden rounded-2xl text-xs font-semibold tracking-[0.16em] transition-all duration-300 sm:h-16 ${
                !lightIsOn
                  ? "bg-white text-black shadow-[0_10px_35px_rgba(255,255,255,0.06)]"
                  : "border border-white/10 bg-white/[0.045] text-white/70 hover:bg-white/10"
              } ${
                changing ||
                !deviceAvailable ||
                device?.state === false
                  ? "cursor-not-allowed opacity-45"
                  : "active:scale-[0.97]"
              }`}
            >

              {!(
                changing ||
                !deviceAvailable ||
                device?.state === false
              ) && (
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              )}

              <span className="relative">
                {changing &&
                device?.state !== false
                  ? "..."
                  : "TURN OFF"}
              </span>

            </button>

          </div>

          {/* =================================================
              ERROR
          ================================================= */}

          {error && (
            <div className="mt-4 w-full max-w-md rounded-xl border border-red-400/15 bg-red-400/[0.04] px-4 py-3 text-center text-xs text-red-300/80">
              {error}
            </div>
          )}

        </section>

      </div>

      {/* ===================================================
          ANIMATIONS
      =================================================== */}

      <style jsx>{`

        /* ================================================
           BULB FLOAT
        ================================================ */

        @keyframes bulbFloat {
          0%,
          100% {
            transform: translateY(0);
          }

          50% {
            transform: translateY(-8px);
          }
        }

        /* ================================================
           ORBIT
        ================================================ */

        @keyframes orbit {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }

        /* ================================================
           SPIN
        ================================================ */

        @keyframes spinSlow {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }

        @keyframes spinReverse {
          from {
            transform: rotate(360deg);
          }

          to {
            transform: rotate(0deg);
          }
        }

        /* ================================================
           CLASSES
        ================================================ */

        .animate-bulb-float {
          animation: bulbFloat 3.2s ease-in-out infinite;
        }

        .animate-orbit {
          animation: orbit 8s linear infinite;
        }

        .animate-spin-slow {
          animation: spinSlow 9s linear infinite;
        }

        .animate-spin-reverse {
          animation: spinReverse 13s linear infinite;
        }

        /* ================================================
           MOBILE
        ================================================ */

        @media (max-width: 640px) {

          .animate-bulb-float {
            animation-duration: 3.8s;
          }

          .animate-orbit {
            animation-duration: 10s;
          }

        }

        /* ================================================
           REDUCED MOTION
        ================================================ */

        @media (prefers-reduced-motion: reduce) {

          .animate-bulb-float,
          .animate-orbit,
          .animate-spin-slow,
          .animate-spin-reverse {
            animation: none !important;
          }

        }

      `}</style>

    </main>
  );
}