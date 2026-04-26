precision highp float;

uniform sampler2D uVideoTex;
uniform float     uTime;
uniform float     uRimStrength;
uniform vec3      uRimColor;
uniform float     uAlpha;
uniform float     uVideoMix;   // 0=poster 1=video (smooth crossfade)
uniform float     uDissolve;   // 0=intact 1=fully dissolved (burst phase)

varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vWorldPos;

// Simple 2D hash for dissolve noise
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), f.x),
             mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), f.x), f.y);
}

void main() {
  // Fresnel
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float NdotV  = clamp(dot(normalize(vNormal), viewDir), 0.0, 1.0);
  float fresnel = pow(1.0 - NdotV, 2.2);

  // Soft multi-sample video blur
  float blur = 0.018;
  vec3 vid = vec3(0.0);
  vid += texture2D(uVideoTex, vUv).rgb;
  vid += texture2D(uVideoTex, vUv + vec2( blur, 0.0)).rgb;
  vid += texture2D(uVideoTex, vUv + vec2(-blur, 0.0)).rgb;
  vid += texture2D(uVideoTex, vUv + vec2(0.0,  blur)).rgb;
  vid += texture2D(uVideoTex, vUv + vec2(0.0, -blur)).rgb;
  vid /= 5.0;
  vid *= 0.55;  // dim so it reads as light, not picture

  // Radial inner falloff (sphere edge is fully transparent except fresnel)
  vec2 c = vUv * 2.0 - 1.0;
  float inner = smoothstep(0.95, 0.4, length(c));

  vec3 rim = uRimColor * uRimStrength * pow(fresnel, 1.6);
  vec3 col = rim + vid * inner * uVideoMix;

  float alpha = (fresnel * 0.75 + inner * 0.35) * uAlpha;

  // Dissolve effect (burst transition)
  if (uDissolve > 0.001) {
    float n  = noise2(vUv * 7.0 + uTime * 0.07);
          n += noise2(vUv * 14.0 - uTime * 0.11) * 0.5;
          n /= 1.5;
    if (n < uDissolve) discard;
    float edge = smoothstep(uDissolve, uDissolve + 0.08, n);
    col   = mix(uRimColor * 3.5, col, edge);
    alpha = edge * uAlpha;
  }

  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
