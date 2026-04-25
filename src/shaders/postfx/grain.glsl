uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uStrength;

varying vec2 vUv;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4  col   = texture2D(tDiffuse, vUv);
  float grain = rand(vUv + fract(uTime * 0.017)) * 2.0 - 1.0;
  col.rgb += grain * uStrength;
  gl_FragColor = col;
}
