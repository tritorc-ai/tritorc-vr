"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, ChevronLeft, Maximize, Minimize } from 'lucide-react';
import * as THREE from 'three';

// Real Tritorc product videos, downloaded directly from the company's Google
// Drive (not YouTube — a real decodable file is required to feed the
// Three.js VideoTexture that projects the video onto the 3D cinema screen;
// a YouTube iframe's pixels are cross-origin-opaque to WebGL and can't do this).
const videos = [
  { id: 1, title: "Square Drive Hydraulic Torque Wrench — TSL Series", url: "/videos/square-drive-torque-wrench-tsl-series.mp4" },
  { id: 2, title: "Pipe Cutting and Bevelling Machine — TCSL & TTCB Series", url: "/videos/pipe-cutting-and-bevelling-machine-tcsl-ttcb.mp4" },
  { id: 3, title: "Hot Tapping and Line Stopping Services", url: "/videos/hot-tapping-and-line-stopping-services.mp4" },
  { id: 4, title: "Tube Spinner — Pneumatic Tube Removal Machine", url: "/videos/tube-spinner-pneumatic-tube-removal-machine.mp4" },
  { id: 5, title: "Tritorc Intro", url: "/videos/tritorc-intro.mp4" },
];

export default function WebXRCinema() {
  const containerRef = useRef(null);
  const [isVRSupported, setIsVRSupported] = useState(false);
  const [isInVR, setIsInVR] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const sceneRef = useRef(null);
  const videoRef = useRef(null);
  const isMutedRef = useRef(true);
  const xrSessionRef = useRef(null);

  useEffect(() => {
    // Quest-compatible WebXR detection
    let cancelled = false;

    if ('xr' in navigator) {
      navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
        if (cancelled) return;
        setIsVRSupported(supported);
      }).catch(() => {
        if (cancelled) return;
        setIsVRSupported(false);
      });
    }

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || !selectedVideo) return;

    const container = containerRef.current;
    const ORBIT_RADIUS = 3;   // metres from the pivot
    const ORBIT_HEIGHT = 1.6; // pivot height = eye level
    const MIN_LAT = -25;      // keeps camera.y above the floor plane
    const MAX_LAT = 45;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);

    const camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, ORBIT_HEIGHT, ORBIT_RADIUS);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    container.appendChild(renderer.domElement);

    // Create video element
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = isMutedRef.current;
    video.playsInline = true;
    video.preload = 'auto';
    videoRef.current = video;

    const onLoadedMetadata = () => setDuration(video.duration);
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onVideoError = () => {
      const code = video.error?.code;
      const messages = {
        1: 'Video loading was aborted.',
        2: 'A network error interrupted the video.',
        3: 'This video could not be decoded.',
        4: 'This video is unavailable or in an unsupported format.'
      };
      setIsPlaying(false);
      setVideoError(messages[code] || 'This video could not be loaded.');
    };

    // Listeners attached before src so no early event can be missed.
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('error', onVideoError);

    video.src = selectedVideo.url;
    video.load();

    // Create video texture
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.colorSpace = THREE.SRGBColorSpace;

    // Flat cinema screen (not 360°)
    const aspectRatio = 16 / 9;
    const screenWidth = 8; // 8 meters wide
    const screenHeight = screenWidth / aspectRatio;

    const screenGeometry = new THREE.PlaneGeometry(screenWidth, screenHeight);
    const screenMaterial = new THREE.MeshBasicMaterial({
      map: videoTexture,
      side: THREE.DoubleSide
    });
    const screen = new THREE.Mesh(screenGeometry, screenMaterial);
    screen.position.set(0, 1.6, -6); // 6 meters away, at eye level
    scene.add(screen);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    const floorGeometry = new THREE.PlaneGeometry(50, 50);
    const floorMaterial = new THREE.MeshBasicMaterial({
      color: 0x111111,
      side: THREE.DoubleSide
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    sceneRef.current = { scene, camera, renderer, video, screen };

    // Mouse/touch controls for non-VR mode
    let isUserInteracting = false;
    let lon = 0, lat = 0;
    let onPointerDownLon = 0, onPointerDownLat = 0;
    let onPointerDownX = 0, onPointerDownY = 0;

    // Discriminate on event shape, never on the truthiness of a coordinate:
    // clientX === 0 is a legitimate value at the left screen edge.
    const getPointerPosition = (e) => {
      const touch =
        (e.touches && e.touches[0]) ||
        (e.changedTouches && e.changedTouches[0]) ||
        null;
      const clientX = touch ? touch.clientX : e.clientX;
      const clientY = touch ? touch.clientY : e.clientY;
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      return { clientX, clientY };
    };

    const onPointerDown = (e) => {
      const point = getPointerPosition(e);
      if (!point) return;
      isUserInteracting = true;
      onPointerDownX = point.clientX;
      onPointerDownY = point.clientY;
      onPointerDownLon = lon;
      onPointerDownLat = lat;
    };

    const onPointerMove = (e) => {
      if (!isUserInteracting) return;
      const point = getPointerPosition(e);
      if (!point) return;
      lon = (onPointerDownX - point.clientX) * 0.1 + onPointerDownLon;
      lat = (point.clientY - onPointerDownY) * 0.1 + onPointerDownLat;
    };

    const onPointerUp = () => {
      isUserInteracting = false;
    };

    renderer.domElement.addEventListener('mousedown', onPointerDown);
    renderer.domElement.addEventListener('mousemove', onPointerMove);
    renderer.domElement.addEventListener('mouseup', onPointerUp);
    renderer.domElement.addEventListener('touchstart', onPointerDown, { passive: true });
    renderer.domElement.addEventListener('touchmove', onPointerMove, { passive: true });
    renderer.domElement.addEventListener('touchend', onPointerUp);
    renderer.domElement.addEventListener('touchcancel', onPointerUp);
    window.addEventListener('mouseup', onPointerUp);

    // Animation loop
    const animate = () => {
      // Camera orbit in non-VR mode around the pivot at (0, 1.6, 0)
      if (!renderer.xr.isPresenting) {
        lat = Math.max(MIN_LAT, Math.min(MAX_LAT, lat));
        const phi = THREE.MathUtils.degToRad(90 - lat);
        const theta = THREE.MathUtils.degToRad(lon);

        camera.position.x = ORBIT_RADIUS * Math.sin(phi) * Math.sin(theta);
        camera.position.y = ORBIT_HEIGHT + ORBIT_RADIUS * Math.cos(phi);
        camera.position.z = ORBIT_RADIUS * Math.sin(phi) * Math.cos(theta);
        camera.lookAt(screen.position);
      }

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
      // 1. Stop producing frames first — nothing below may run mid-frame.
      renderer.setAnimationLoop(null);

      // 2. Detach every listener we own.
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mouseup', onPointerUp);
      renderer.domElement.removeEventListener('mousedown', onPointerDown);
      renderer.domElement.removeEventListener('mousemove', onPointerMove);
      renderer.domElement.removeEventListener('mouseup', onPointerUp);
      renderer.domElement.removeEventListener('touchstart', onPointerDown);
      renderer.domElement.removeEventListener('touchmove', onPointerMove);
      renderer.domElement.removeEventListener('touchend', onPointerUp);
      renderer.domElement.removeEventListener('touchcancel', onPointerUp);

      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onVideoError);

      // 3. Tear the media element down: aborts the fetch, frees the decoder.
      //    removeAttribute + load() — NOT src = ''.
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (videoRef.current === video) videoRef.current = null;

      // 4. Detach the canvas.
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }

      // 5. GPU teardown. Scene contents FIRST (their 'dispose' events are handled
      //    by the still-live renderer), then the renderer, then the context.
      const disposeGpu = () => {
        scene.traverse((object) => {
          if (!object.isMesh) return;
          object.geometry?.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if (!material) return;
            Object.values(material).forEach((value) => {
              if (value && value.isTexture) value.dispose();
            });
            material.dispose();
          });
        });
        scene.clear();
        renderer.dispose();
        renderer.forceContextLoss();
      };

      // 6. If an XR session is live, end it and DEFER the GPU teardown until the
      //    session has actually ended — three's own onSessionEnd handler touches
      //    the renderer, so disposing synchronously runs it on a lost context.
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

  const enterVR = async () => {
    if (!sceneRef.current || !isVRSupported) return;

    try {
      // The video is a real texture inside the 3D scene, natively stereo-
      // rendered by WebXR — unlike a YouTube iframe, there's no dom-overlay
      // dependency here at all, so this can't get stuck with "nothing to show."
      const session = await navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['bounded-floor', 'hand-tracking']
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
      setIsInVR(true);

      const video = videoRef.current;
      if (video && video.paused) {
        video.play().catch((err) => {
          console.log('Video autoplay prevented:', err);
        });
      }
    } catch (err) {
      console.error('Failed to enter VR:', err);
      alert('Failed to enter VR mode. Error: ' + err.message);
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      setVideoError(null);
      video.play().catch((err) => {
        console.error('Video play failed:', err);
        setVideoError('Playback could not be started. Try again.');
      });
    } else {
      video.pause();
    }
  };

  const toggleMute = () => {
    const next = !isMuted;
    if (videoRef.current) {
      videoRef.current.muted = next;
    }
    setIsMuted(next);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      const target = containerRef.current?.parentElement;
      if (target?.requestFullscreen) {
        target.requestFullscreen().catch((err) => {
          console.warn('Fullscreen request failed:', err);
        });
      }
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
    // Video teardown is owned by the scene effect's cleanup, which runs as soon
    // as selectedVideo goes null. Doing it here too (and with src = '') makes the
    // browser refetch the page URL as media and fire a spurious 'error'.
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    setIsPlaying(false);
    setSelectedVideo(null);
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
                    <div className="aspect-video bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center relative overflow-hidden">
                      <Play size={40} className="sm:w-12 sm:h-12 text-orange-500 group-hover:scale-110 transition-transform" />
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

      {/* Video Player UI — hidden while in VR: the theatre screen inside the
          headset is the actual video, not a DOM overlay, so these 2D controls
          have no XR-visible counterpart. Video keeps auto-playing in VR. */}
      {selectedVideo && !isInVR && (
        <>
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
                <p className="text-xs sm:text-sm text-gray-300 mt-0.5 sm:mt-1 hidden sm:block">Drag to look around</p>
              </div>

              {isVRSupported && (
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

          <div className="absolute top-16 sm:top-20 lg:top-24 left-0 right-0 px-3 sm:px-4 lg:px-6 z-10">
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

          {videoError && (
            <div className="absolute inset-x-0 top-24 sm:top-28 lg:top-32 px-3 sm:px-4 lg:px-6 z-20 pointer-events-none">
              <div className="bg-red-500/20 border border-red-500/50 rounded-lg sm:rounded-xl p-3 sm:p-4 max-w-2xl mx-auto backdrop-blur-sm">
                <p className="text-red-200 text-xs sm:text-sm text-center">
                  {videoError}
                </p>
              </div>
            </div>
          )}

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
