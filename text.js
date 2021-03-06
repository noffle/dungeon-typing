var mat4 = require('gl-mat4')
var vectorize = require('./text2')

module.exports = function (regl, text, color) {
  var mesh = vectorize(text)
  mesh.positions = mesh.positions.map(function (p) {
    p[1] += 1.5
    return p
  })

  var cmd = regl({
    frag: `
      precision mediump float;

      uniform vec4 color;

      void main () {
        gl_FragColor = color;
      }
    `,

    vert: `
      precision mediump float;

      uniform mat4 projection;
      uniform mat4 view;
      uniform mat4 model;
      attribute vec2 pos;

      void main () {
        gl_Position = projection * view * model * vec4(pos, 0.0, 1.0);
      }
    `,

    blend: {
      enable: true,
      func: {
        src: 'src alpha',
        dst: 'one minus src alpha'
      }
    },

    attributes: {
      pos: mesh.positions
    },

    uniforms: {
      projection: regl.prop('projection'),
      view: regl.prop('view'),
      model: regl.prop('model'),
      color: function () { return cmd.color }
    },

    elements: mesh.cells,

    // depth: { enable: false }
  })
  cmd.color = color || [1, 1, 1, 1]
  return cmd
}
