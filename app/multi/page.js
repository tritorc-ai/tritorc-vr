"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Maximize, ChevronLeft, Volume2, VolumeX, Minimize } from 'lucide-react';
import Image from 'next/image';

// Real Tritorc product/service demo videos, sourced from
// https://www.youtube.com/@TritorcEquipments/videos (English versions only).
const videos = [
  { id: 1, title: "Square Drive Hydraulic Torque Wrench — TSL Series", youtubeId: "T-INgo5-VvY" },
  { id: 2, title: "Pipe Cutting and Bevelling Machine — TCSL & TTCB Series", youtubeId: "9voGBcSrJM4" },
  { id: 3, title: "Hot Tapping and Line Stopping Services", youtubeId: "fBZ_SKCH7-4" },
];

const YT_PLAYER_MOUNT_ID = 'tritorc-yt-player-multi';

function loadYouTubeIframeAPI() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  });
}

export default function VRVideoViewer() {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const [selectedVideo, setSelectedVideo] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoError, setVideoError] = useState(null);
  const [playerReady, setPlayerReady] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // YouTube player lifecycle: create on selection, destroy on menu/selection change.
  useEffect(() => {
    if (!selectedVideo) return;

    let cancelled = false;
    setPlayerReady(false);
    setVideoError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    loadYouTubeIframeAPI().then((YT) => {
      if (cancelled || !document.getElementById(YT_PLAYER_MOUNT_ID)) return;

      const player = new YT.Player(YT_PLAYER_MOUNT_ID, {
        videoId: selectedVideo.youtubeId,
        playerVars: {
          autoplay: 1,
          mute: 1,
          playsinline: 1,
          modestbranding: 1,
          rel: 0,
          controls: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            if (cancelled) return;
            event.target.mute();
            setDuration(event.target.getDuration());
            setPlayerReady(true);
          },
          onStateChange: (event) => {
            if (cancelled) return;
            if (event.data === window.YT.PlayerState.PLAYING) setIsPlaying(true);
            else if (event.data === window.YT.PlayerState.PAUSED || event.data === window.YT.PlayerState.ENDED) setIsPlaying(false);
          },
          onError: () => {
            if (cancelled) return;
            setVideoError('This video could not be played.');
          },
        },
      });
      playerRef.current = player;
    });

    return () => {
      cancelled = true;
      setPlayerReady(false);
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* player already gone */ }
        playerRef.current = null;
      }
    };
  }, [selectedVideo]);

  // The IFrame API has no continuous timeupdate event — poll for progress.
  useEffect(() => {
    if (!playerReady) return;

    pollIntervalRef.current = setInterval(() => {
      const player = playerRef.current;
      if (!player || typeof player.getCurrentTime !== 'function') return;
      setCurrentTime(player.getCurrentTime());
      const d = player.getDuration();
      if (d) setDuration(d);
    }, 250);

    return () => clearInterval(pollIntervalRef.current);
  }, [playerReady]);

  const togglePlay = () => {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) {
      player.pauseVideo();
    } else {
      setVideoError(null);
      player.playVideo();
    }
  };

  const toggleMute = () => {
    const player = playerRef.current;
    const next = !isMuted;
    if (player) {
      if (next) player.mute();
      else player.unMute();
    }
    setIsMuted(next);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const selectVideo = (video) => {
    setSelectedVideo(video);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setVideoError(null);
  };

  const backToMenu = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    setSelectedVideo(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setVideoError(null);
  };

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div ref={containerRef} className="relative w-screen h-screen bg-gray-50 overflow-hidden">
      {/* Main Menu */}
      {!selectedVideo && (
        <div className="absolute inset-0 overflow-auto bg-white">
          <div className="min-h-full flex items-center justify-center p-4 sm:p-6 md:p-8">
            <div className="max-w-6xl w-full">
              <div className="text-center mb-12">
                <Image
                  src="/images/logo.png"
                  alt="Tritorc Logo"
                  width={224}
                  height={64}
                  className="mx-auto mb-4 w-40 md:w-56 animate-fade-in"
                />
                <p className="text-xl text-black">
                  Experience Our Tools in Immersive VR
                </p>
              </div>

              {/* Video Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 md:gap-6 px-4">
                {videos.map((video) => (
                  <button
                    key={video.id}
                    onClick={() => selectVideo(video)}
                    className="bg-white rounded-xl sm:rounded-2xl overflow-hidden hover:shadow-2xl transition-all duration-300 group border-2 border-gray-200 hover:border-gray-400"
                  >
                    <div className="aspect-video overflow-hidden relative">
                      <img
                        src={`https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/10 group-hover:bg-black/5 transition-colors flex items-center justify-center">
                        <Play size={48} className="relative z-10 text-white drop-shadow-lg group-hover:scale-110 transition-transform" fill="currentColor" />
                      </div>
                    </div>
                    <div className="p-4 sm:p-5 md:p-6 text-left">
                      <h3 className="text-base sm:text-lg md:text-xl font-bold text-gray-900 group-hover:text-gray-700 transition-colors">
                        {video.title}
                      </h3>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Video Player UI */}
      {selectedVideo && (
        <>
          {/* Top Bar */}
          <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent p-3 sm:p-4 md:p-6 z-10">
            <div className="flex items-center justify-between gap-2 sm:gap-4">
              <button
                onClick={backToMenu}
                className="bg-white/90 hover:bg-white text-gray-900 px-3 py-2 sm:px-4 sm:py-2 rounded-lg flex items-center gap-1 sm:gap-2 transition-all active:scale-[0.97] text-sm sm:text-base font-medium"
              >
                <ChevronLeft size={18} className="sm:w-5 sm:h-5" />
                <span className="hidden sm:inline">Back</span>
              </button>

              <div className="flex-1 text-white text-right">
                <h2 className="text-sm sm:text-lg md:text-xl font-bold truncate drop-shadow-lg">{selectedVideo.title}</h2>
              </div>
            </div>
          </div>

          {/* Video panel */}
          <div className="absolute inset-0 flex items-center justify-center p-4 pt-20 pb-28 sm:pt-24 sm:pb-32">
            <div className="relative w-full max-w-5xl aspect-video bg-black rounded-xl sm:rounded-2xl overflow-hidden shadow-2xl">
              <div id={YT_PLAYER_MOUNT_ID} className="absolute inset-0 w-full h-full" />

              {videoError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4">
                  <p className="text-red-200 text-sm text-center max-w-sm">{videoError}</p>
                </div>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="absolute bottom-20 sm:bottom-24 left-0 right-0 px-3 sm:px-4 md:px-6 z-10">
            <div className="bg-white/20 backdrop-blur-sm rounded-full h-1 sm:h-1.5 overflow-hidden">
              <div
                className="bg-gray-900 h-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-white drop-shadow mt-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Bottom Controls */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 sm:p-4 md:p-6 z-10">
            <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
              <button
                onClick={togglePlay}
                className="bg-gray-900 hover:bg-gray-800 text-white px-4 sm:px-6 md:px-8 py-2 sm:py-3 rounded-full flex items-center gap-2 transition-all active:scale-[0.97] font-semibold text-sm sm:text-base"
              >
                {isPlaying ? <Pause size={18} className="sm:w-5 sm:h-5" /> : <Play size={18} className="sm:w-5 sm:h-5" />}
                <span className="hidden sm:inline">{isPlaying ? 'Pause' : 'Play'}</span>
              </button>

              <button
                onClick={toggleMute}
                className="bg-white/90 hover:bg-white text-gray-900 p-2 sm:p-3 rounded-full transition-all active:scale-[0.97]"
              >
                {isMuted ? <VolumeX size={18} className="sm:w-5 sm:h-5" /> : <Volume2 size={18} className="sm:w-5 sm:h-5" />}
              </button>

              <button
                onClick={toggleFullscreen}
                className="bg-white/90 hover:bg-white text-gray-900 p-2 sm:p-3 rounded-full transition-all active:scale-[0.97]"
              >
                {isFullscreen ? <Minimize size={18} className="sm:w-5 sm:h-5" /> : <Maximize size={18} className="sm:w-5 sm:h-5" />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
