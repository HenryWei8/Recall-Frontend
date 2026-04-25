precision highp float;

uniform float uTime;
uniform float uDisplacement;
uniform float uPulse;
uniform float uRipple;

varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vWorldPos;

float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float smoothNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
        mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
        mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

void main() {
  vUv     = uv;
  vNormal = normalize(normalMatrix * normal);

  // Low-frequency breathing displacement
  float n = smoothNoise(position * 1.4 + uTime * 0.18) * 2.0 - 1.0;
  float disp = n * uDisplacement;

  // Ripple for burst transition
  float ripplePhase = length(position) * 6.0 - uTime * 12.0;
  disp += sin(ripplePhase) * uRipple;

  vec3 displaced = position + normal * disp;

  // Gentle pulse
  float pulse = 1.0 + sin(uTime * 1.7) * 0.018 * uPulse;
  displaced *= pulse;

  vec4 world = modelMatrix * vec4(displaced, 1.0);
  vWorldPos  = world.xyz;

  gl_Position = projectionMatrix * viewMatrix * world;
}
