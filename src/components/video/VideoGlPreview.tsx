/**
 * Aperçu WebGL de l'éditeur vidéo — étapes 5 et 6.
 *
 * Exécute exactement la même formule de réglage que le shader natif
 * `VideoGl.kt`. Le recadrage et la rotation sont appliqués dans le vertex
 * shader ; les réglages colorimétriques sont dans le fragment shader.
 *
 * Quand WebGL n'est pas disponible, on retombe sur la balise `<video>`
 * brute avec les transformations CSS, ce qui reste fonctionnel.
 */
import { useEffect, useRef } from "react";
import type { VideoEdit } from "@/lib/video/edit";

const VERTEX_SHADER = `
attribute vec2 aPosition;
attribute vec2 aTexCoord;
uniform mat4 uTexMatrix;
uniform mat4 uRotation;
uniform vec4 uCrop;
varying vec2 vTexCoord;
void main() {
  gl_Position = uRotation * vec4(aPosition, 0.0, 1.0);
  vec2 src = uCrop.xy + aTexCoord * uCrop.zw;
  vTexCoord = (uTexMatrix * vec4(src, 0.0, 1.0)).xy;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;
uniform float uBrightness;
uniform float uContrast;
uniform float uExposure;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
uniform float uSharpness;
uniform vec2 uTexel;

void main() {
  vec3 c = texture2D(uTexture, vTexCoord).rgb;

  if (uSharpness != 0.0) {
    vec3 blur = texture2D(uTexture, vTexCoord + uTexel).rgb
              + texture2D(uTexture, vTexCoord - uTexel).rgb
              + texture2D(uTexture, vTexCoord + vec2(uTexel.x, -uTexel.y)).rgb
              + texture2D(uTexture, vTexCoord + vec2(-uTexel.x, uTexel.y)).rgb;
    c = c + uSharpness * (c - blur * 0.25);
  }

  c *= pow(2.0, uExposure);
  c += uBrightness;
  c = (c - 0.5) * (1.0 + uContrast) + 0.5;
  c.r += uTemperature * 0.12;
  c.b -= uTemperature * 0.12;
  c.g += uTint * 0.12;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, 1.0 + uSaturation);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

export function VideoGlPreview({
  video,
  edit,
  disabled,
  onReady,
  onFail,
}: {
  video: HTMLVideoElement | null;
  edit: VideoEdit;
  disabled?: boolean;
  onReady?: () => void;
  onFail?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<GlState | null>(null);
  const rafRef = useRef<number | null>(null);
  const editRef = useRef(edit);
  editRef.current = edit;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  useEffect(() => {
    const canvas = canvasRef.current;
    const v = video;
    if (!canvas || !v || disabled) {
      onFailRef.current?.();
      return;
    }

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      onFailRef.current?.();
      return;
    }

    const program = buildProgram(gl);
    if (!program) {
      onFailRef.current?.();
      return;
    }
    onReadyRef.current?.();

    const aPosition = gl.getAttribLocation(program, "aPosition");
    const aTexCoord = gl.getAttribLocation(program, "aTexCoord");
    const uTexMatrix = gl.getUniformLocation(program, "uTexMatrix")!;
    const uRotation = gl.getUniformLocation(program, "uRotation")!;
    const uCrop = gl.getUniformLocation(program, "uCrop")!;
    const uTexel = gl.getUniformLocation(program, "uTexel")!;
    const uTexture = gl.getUniformLocation(program, "uTexture")!;
    const uniforms: Record<string, WebGLUniformLocation> = {};
    for (const name of [
      "uBrightness",
      "uContrast",
      "uExposure",
      "uSaturation",
      "uTemperature",
      "uTint",
      "uSharpness",
    ]) {
      uniforms[name] = gl.getUniformLocation(program, name)!;
    }

    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    glRef.current = {
      gl,
      program,
      aPosition,
      aTexCoord,
      uTexMatrix,
      uRotation,
      uCrop,
      uTexel,
      uTexture,
      uniforms,
      texture,
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let lastTime = -1;
    const draw = () => {
      if (!glRef.current || v.paused || v.ended) return;
      if (v.currentTime !== lastTime) {
        lastTime = v.currentTime;
        render(glRef.current, canvas, v, editRef.current);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      glRef.current = null;
    };
  }, [video, disabled]);

  // Met à jour les réglages sans recréer le contexte.
  useEffect(() => {
    const state = glRef.current;
    const canvas = canvasRef.current;
    const v = video;
    if (!state || !canvas || !v || disabled) return;
    render(state, canvas, v, editRef.current);
  }, [edit, video, disabled]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    />
  );
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p);
    return null;
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return p;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
const texCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

type GlState = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  aPosition: number;
  aTexCoord: number;
  uTexMatrix: WebGLUniformLocation;
  uRotation: WebGLUniformLocation;
  uCrop: WebGLUniformLocation;
  uTexel: WebGLUniformLocation;
  uTexture: WebGLUniformLocation;
  uniforms: Record<string, WebGLUniformLocation>;
  texture: WebGLTexture;
};

function render(
  state: GlState,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  edit: VideoEdit,
) {
  const {
    gl,
    program,
    aPosition,
    aTexCoord,
    uTexMatrix,
    uRotation,
    uCrop,
    uTexel,
    uTexture,
    uniforms,
    texture,
  } = state;

  const srcW = video.videoWidth || 1;
  const srcH = video.videoHeight || 1;

  // Viewport ajusté à la zone d'affichage pour garder l'image entière.
  const displayW = canvas.clientWidth || 1;
  const displayH = canvas.clientHeight || 1;
  const displayRatio = displayW / displayH;
  const swap = edit.rotation === 90 || edit.rotation === 270;
  const cropW = srcW * edit.crop.w;
  const cropH = srcH * edit.crop.h;
  const outW = swap ? cropH : cropW;
  const outH = swap ? cropW : cropH;
  const outRatio = outW / outH;

  let vpW = displayW;
  let vpH = displayH;
  if (outRatio > displayRatio) {
    vpH = Math.round(displayW / outRatio);
  } else {
    vpW = Math.round(displayH * outRatio);
  }
  const vpX = Math.floor((displayW - vpW) / 2);
  const vpY = Math.floor((displayH - vpH) / 2);

  gl.viewport(
    vpX * (canvas.width / displayW),
    vpY * (canvas.height / displayH),
    vpW * (canvas.width / displayW),
    vpH * (canvas.height / displayH),
  );
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(program);

  // Texture.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  gl.uniform1i(uTexture, 0);

  // Matrice de texture : identité (le navigateur fournit déjà les pixels orientés).
  const texMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  gl.uniformMatrix4fv(uTexMatrix, false, texMatrix);

  // Rotation.
  const angle = -edit.rotation * (Math.PI / 180);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rot = new Float32Array([c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  gl.uniformMatrix4fv(uRotation, false, rot);

  // Recadrage.
  gl.uniform4f(uCrop, edit.crop.x, edit.crop.y, edit.crop.w, edit.crop.h);
  gl.uniform2f(uTexel, 1 / Math.max(srcW, 1), 1 / Math.max(srcH, 1));

  // Réglages.
  gl.uniform1f(uniforms.uBrightness, edit.brightness);
  gl.uniform1f(uniforms.uContrast, edit.contrast);
  gl.uniform1f(uniforms.uExposure, edit.exposure);
  gl.uniform1f(uniforms.uSaturation, edit.saturation);
  gl.uniform1f(uniforms.uTemperature, edit.temperature);
  gl.uniform1f(uniforms.uTint, edit.tint);
  gl.uniform1f(uniforms.uSharpness, edit.sharpness);

  // Attributs.
  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  const texBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
  gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(aTexCoord);
  gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.deleteBuffer(posBuf);
  gl.deleteBuffer(texBuf);
}
