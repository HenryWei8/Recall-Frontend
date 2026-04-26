uniform sampler2D tDiffuse;
uniform float uStrength;

varying vec2 vUv;

void main() {
  vec2 dir  = vUv - 0.5;
  float d   = length(dir);
  vec2 off  = dir * uStrength * d;

  float r = texture2D(tDiffuse, vUv + off).r;
  float g = texture2D(tDiffuse, vUv).g;
  float b = texture2D(tDiffuse, vUv - off).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}
