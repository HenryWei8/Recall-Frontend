precision highp float;

uniform vec3 uColor;

varying float vAlpha;

void main() {
  vec2  uv   = gl_PointCoord * 2.0 - 1.0;
  float dist = length(uv);
  if (dist > 1.0) discard;

  float softEdge = 1.0 - smoothstep(0.3, 1.0, dist);
  gl_FragColor = vec4(uColor + 0.3, softEdge * vAlpha);
}
