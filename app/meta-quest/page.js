"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, ChevronLeft, Maximize, Minimize } from 'lucide-react';
import * as THREE from 'three';

// Real Tritorc product/service demo videos, sourced from
// https://www.youtube.com/@TritorcEquipments/videos (English versions only).
const videos = [
  { id: 1, title: "Square Drive Hydraulic Torque Wrench — TSL Series", youtubeId: "T-INgo5-VvY" },
  { id: 2, title: "Pipe Cutting and Bevelling Machine — TCSL & TTCB Series", youtubeId: "9voGBcSrJM4" },
  { id: 3, title: "Hot Tapping and Line Stopping Services", youtubeId: "fBZ_SKCH7-4" },
];

const YT_PLAYER_MOUNT_ID = 'tritorc-yt-player-meta-quest';

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

export default function WebXRCinema() {
  const containerRef = useRef(null);
  const overlayRef = useRef(null);
  const sceneRef = useRef(null);
  const xrSessionRef = useRef(null);
  const playerRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const [isVRSupported, setIsVRSupported] = useState(false);
  const [isInVR, setIsInVR] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const [vrMessage, setVrMessage] = useState(null);
  const [playerReady, setPlayerReady] = useState(false);

  useEffect(() => {
    if ('xr' in navigator) {
      navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
        setIsVRSupported(supported);
      }).catch(() => {
        setIsVRSupported(false);
      });
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Minimal Three.js scene: just an XR-capable rendering host. There's no video
  // texture/sphere here anymore — a YouTube iframe can't feed a WebGL texture
  // (cross-origin iframe pixels are opaque to canvas/WebGL), so playback lives
  // in the DOM (see the YouTube player effect below) and is projected into the
  // headset via the dom-overlay wired up in enterVR.
  useEffect(() => {
    if (!containerRef.current || !selectedVideo) return;

    const container = containerRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 1.6, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    // A guaranteed way to exit VR that does NOT depend on dom-overlay support:
    // point a controller at this panel and pull the trigger. dom-overlay
    // reporting itself as granted doesn't guarantee it actually renders/responds
    // on every headset/browser, and getting trapped in VR with no way back to
    // the Back button is a real dead end — this native controller-ray exit
    // always works because it uses the standard WebXR input API directly.
    const exitButton = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xdc2626 })
    );
    exitButton.position.set(0, 1.6, -1.2);
    scene.add(exitButton);

    const raycaster = new THREE.Raycaster();
    const tempMatrix = new THREE.Matrix4();
    const onSelectStart = (event) => {
      const controller = event.target;
      tempMatrix.identity().extractRotation(controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
      if (raycaster.intersectObject(exitButton).length > 0) {
        renderer.xr.getSession()?.end();
      }
    };
    const controllers = [0, 1].map((i) => {
      const controller = renderer.xr.getController(i);
      controller.addEventListener('selectstart', onSelectStart);
      scene.add(controller);
      return controller;
    });

    sceneRef.current = { scene, camera, renderer };

    const animate = () => {
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(animate);

    const handleResize = () => {
      if (!containerRef.current) return;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', handleResize);
      controllers.forEach((controller) => controller.removeEventListener('selectstart', onSelectStart));

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }

      const disposeGpu = () => {
        renderer.dispose();
        renderer.forceContextLoss();
      };

      const activeSession = renderer.xr.getSession();
      if (xrSessionRef.current) {
        xrSessionRef.current.session.removeEventListener('end', xrSessionRef.current.onEnd);
        xrSessionRef.current = null;
      }

      if (activeSession) {
        activeSession.addEventListener('end', disposeGpu, { once: true });
        Promise.resolve(activeSession.end()).catch(() => {
          activeSession.removeEventListener('end', disposeGpu);
          disposeGpu();
        });
      } else {
        renderer.xr.enabled = false;
        disposeGpu();
      }

      sceneRef.current = null;
    };
  }, [selectedVideo]);

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

  const enterVR = async () => {
    if (!sceneRef.current || !isVRSupported) return;

    try {
      // dom-overlay projects our 2D controls AND the YouTube player panel into
      // the headset as a floating panel — there's no 360 sphere to render it
      // onto anymore, so without this feature entering VR would show only an
      // empty void with no way to watch or control anything.
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'dom-overlay'],
        domOverlay: overlayRef.current ? { root: overlayRef.current } : undefined
      });

      const onSessionEnd = () => {
        session.removeEventListener('end', onSessionEnd);
        if (xrSessionRef.current?.session === session) {
          xrSessionRef.current = null;
        }
        setIsInVR(false);
      };
      session.addEventListener('end', onSessionEnd);
      xrSessionRef.current = { session, onEnd: onSessionEnd };

      await sceneRef.current.renderer.xr.setSession(session);

      // dom-overlay was only requested as optional, so the session can succeed
      // without it (the spec only mandates browser support for immersive-ar;
      // immersive-vr support is a browser-specific extra). If it wasn't
      // granted there is nothing to render in the headset — no 360 sphere, no
      // overlay panel — so end the session immediately instead of leaving the
      // user stuck looking at an empty black room with no way out.
      if (!session.domOverlayState) {
        await session.end();
        // Native alert()/confirm() dialogs are unreliable inside VR-shell
        // browsers (Oculus Browser appears to silently swallow them), so this
        // is a rendered banner rather than alert().
        setVrMessage("This headset/browser doesn't support showing the video panel while in VR. Playback continues in the regular 2D view below.");
        return;
      }

      setIsInVR(true);
    } catch (err) {
      console.error('Failed to enter VR:', err);
      setVrMessage('Failed to enter VR mode: ' + err.message);
    }
  };

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
      containerRef.current?.parentElement?.requestFullscreen().catch(() => {});
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
    <div className="fixed inset-0 w-full h-full bg-gray-900 overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />

      {/* Main Menu */}
      {!selectedVideo && (
        <div className="absolute inset-0 overflow-y-auto bg-gradient-to-br from-gray-900 via-gray-800 to-black">
          <div className="min-h-full flex items-center justify-center p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl w-full">
              <div className="text-center mb-3">
                <img
                  src="/images/logo.png"
                  alt="Tritorc Logo"
                  className="mx-auto mb-4 w-40 md:w-56 animate-fade-in"
                />
              </div>
              <div className="mb-8 sm:mb-12 lg:mb-16 text-center">
                <h2 className="text-xl sm:text-2xl lg:text-3xl text-white font-light mb-2 sm:mb-4 px-4">
                  Virtual Cinema Experience
                </h2>
                <p className="text-sm sm:text-base lg:text-lg text-gray-400 mb-4 sm:mb-6 px-4">
                  Watch your product videos in an immersive VR theater
                </p>
                {!isVRSupported && (
                  <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg sm:rounded-xl p-3 sm:p-4 max-w-2xl mx-4 sm:mx-auto">
                    <p className="text-yellow-200 text-xs sm:text-sm">
                      WebXR not detected. For the full VR experience, please open this on Meta Quest browser.
                    </p>
                  </div>
                )}
              </div>

              {/* Video Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6 px-4">
                {videos.map((video) => (
                  <button
                    key={video.id}
                    onClick={() => selectVideo(video)}
                    className="bg-gray-800 rounded-xl sm:rounded-2xl overflow-hidden hover:shadow-2xl hover:shadow-orange-500/20 transition-all duration-300 group border-2 border-gray-700 hover:border-orange-500 w-full"
                  >
                    <div className="aspect-video overflow-hidden relative">
                      <img
                        src={`https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                        <Play size={40} className="sm:w-12 sm:h-12 text-white drop-shadow-lg group-hover:scale-110 transition-transform" fill="currentColor" />
                      </div>
                    </div>
                    <div className="p-4 sm:p-5 lg:p-6 text-left">
                      <h3 className="text-base sm:text-lg lg:text-xl font-bold text-white group-hover:text-orange-400 transition-colors line-clamp-2">
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

      {/* Video Player UI. Stays mounted while in VR: this same tree becomes the
          WebXR dom-overlay panel, so it must not disappear on isInVR — the
          YouTube player panel lives inside it too, since that's the only place
          the video is actually visible now (no 360 sphere). */}
      {selectedVideo && (
        <div ref={overlayRef} className="absolute inset-0">
          <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/90 via-black/50 to-transparent p-3 sm:p-4 lg:p-6 z-10">
            <div className="flex items-center justify-between gap-2 sm:gap-4">
              <button
                onClick={backToMenu}
                className="bg-white/90 hover:bg-white text-gray-900 px-3 py-2 sm:px-4 sm:py-2 rounded-lg flex items-center gap-1 sm:gap-2 transition-all active:scale-[0.97] font-medium text-sm sm:text-base flex-shrink-0"
              >
                <ChevronLeft size={18} className="sm:w-5 sm:h-5" />
                <span className="hidden xs:inline">Back</span>
              </button>

              <div className="text-white text-center flex-1 min-w-0 mx-2">
                <h2 className="text-sm sm:text-lg lg:text-xl font-bold drop-shadow-lg truncate">{selectedVideo.title}</h2>
              </div>

              {isVRSupported && !isInVR && (
                <button
                  onClick={enterVR}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 sm:px-4 sm:py-2 lg:px-6 rounded-lg font-semibold transition-all active:scale-[0.97] shadow-lg text-xs sm:text-sm lg:text-base flex-shrink-0"
                >
                  <span className="hidden sm:inline">Enter VR</span>
                  <span className="sm:hidden">VR</span>
                </button>
              )}
            </div>
          </div>

          {vrMessage && (
            <div className="absolute inset-x-0 top-20 sm:top-24 px-3 sm:px-4 lg:px-6 z-20 flex justify-center">
              <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg sm:rounded-xl p-3 sm:p-4 max-w-2xl w-full backdrop-blur-sm flex items-start justify-between gap-3">
                <p className="text-yellow-200 text-xs sm:text-sm">{vrMessage}</p>
                <button
                  onClick={() => setVrMessage(null)}
                  className="text-yellow-200 hover:text-white text-xs sm:text-sm font-medium flex-shrink-0"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

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

          <div className="absolute bottom-20 sm:bottom-24 left-0 right-0 px-3 sm:px-4 lg:px-6 z-10">
            <div className="bg-white/20 backdrop-blur-sm rounded-full h-1 sm:h-1.5 overflow-hidden">
              <div
                className="bg-orange-500 h-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-white drop-shadow mt-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 sm:p-4 lg:p-6 z-10">
            <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
              <button
                onClick={togglePlay}
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 sm:px-6 lg:px-8 py-2 sm:py-3 rounded-full flex items-center gap-1 sm:gap-2 transition-all active:scale-[0.97] font-semibold text-sm sm:text-base shadow-lg"
              >
                {isPlaying ? <Pause size={18} className="sm:w-5 sm:h-5" /> : <Play size={18} className="sm:w-5 sm:h-5" />}
                <span className="hidden xs:inline">{isPlaying ? 'Pause' : 'Play'}</span>
              </button>

              <button
                onClick={toggleMute}
                className="bg-white/90 hover:bg-white text-gray-900 p-2 sm:p-3 rounded-full transition-all active:scale-[0.97]"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX size={18} className="sm:w-5 sm:h-5" /> : <Volume2 size={18} className="sm:w-5 sm:h-5" />}
              </button>

              {!isInVR && (
                <button
                  onClick={toggleFullscreen}
                  className="bg-white/90 hover:bg-white text-gray-900 p-2 sm:p-3 rounded-full transition-all active:scale-[0.97]"
                  title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? <Minimize size={18} className="sm:w-5 sm:h-5" /> : <Maximize size={18} className="sm:w-5 sm:h-5" />}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VR Mode Indicator */}
      {isInVR && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-4 sm:px-6 py-2 rounded-full font-semibold shadow-lg z-50 text-xs sm:text-sm">
          VR Mode Active
        </div>
      )}

      <style jsx>{`
        @media (min-width: 475px) {
          .xs\\:inline {
            display: inline;
          }
        }
      `}</style>
    </div>
  );
}
