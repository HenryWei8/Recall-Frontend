precision highp float;

attribute float aLife;   // 0=born 1=dead

uniform float uSize;
uniform float uTime;

varying float vAlpha;

void main() {
  float life  = clamp(aLife, 0.0, 1.0);
  float twink = 0.6 + 0.4 * sin(uTime * 4.0 + position.x * 13.7 + position.z * 9.3);
  vAlpha = (1.0 - life * life) * twink;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * (200.0 / -mv.z) * (1.0 - life * 0.5);
  gl_Position  = projectionMatrix * mv;
}
