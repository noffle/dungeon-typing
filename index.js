var regl = require('regl')()
var mat4 = require('gl-mat4')
var key = require('key-pressed')
var Voxel = require('./voxel')
var dungeon = require('dungeon-generator')
var Sky = require('./sky')
var nano = require('nano-ecs')
var vec3 = require('gl-vec3')
var Billboard = require('./billboard')
var Text = require('./text')

var camera = {
  pos: [0, -2, -10],
  rot: [0, 0, 0]
}

var letters = 0
var lastLetter = 0

var systems = [
  updatePhysics,
  updateCamera,
  updateMobAI
]

var projection

var world = nano()
var map

function pointLight (lpos, lightIntensity, vpos, normal) {
  var out = vec3.create()
  var dir = vec3.sub(out, vpos, lpos)
  var dist = vec3.length(out)
  return Math.min(2.0, Math.max(0, lightIntensity / (dist*dist)))
}

// gravity-affected, bounding box vs tilemap, position
function Physics () {
  this.pos = {
    x: 0,
    y: 0,
    z: 0
  }
  this.width = 4
  this.length = 4
  this.height = 4

  this.friction = 0.94

  this.vel = {
    x: 0,
    y: 0,
    z: 0
  }
}

function MobAI () {
}

function CameraController () {
  this.rot = {
    x: 0,
    y: 0,
    z: 0
  }
}

function Text3D () {
  this.generate = function (string) {
    this.draw = Text(regl, string)
  }

  this.x = this.y = this.z = 0
  this.draw = undefined
  this.expireTime = new Date().getTime() + 1500
}


require('resl')({
  manifest: {
    atlas: {
      type: 'image',
      src: 'atlas.png',
      parser: function (data) {
        return regl.texture({
          data: data,
          min: 'nearest',
          mag: 'nearest'
        })
      }
    },
    foe: {
      type: 'image',
      src: 'assets/foe.png',
      parser: function (data) {
        return regl.texture({
          data: data,
          min: 'nearest',
          mag: 'nearest'
        })
      }
    }
  },

  onDone: run
})

function generateLevel (w, h) {
  var dun = new dungeon({
    size: [w, h],
    rooms: {
      initial: {
        min_size: [3, 3],
        max_size: [3, 3],
        max_exits: 1,
        position: [0, 0]
      },
      any: {
        min_size: [5, 5],
        max_size: [8, 8],
        max_exits: 4
      }
    },
    max_corridor_length: 7,
    min_corridor_length: 2,
    corridor_density: 0.5,
    symmetric_rooms: false,
    interconnects: 1,
    max_interconnect_length: 10,
    room_count: 6
  })

  dun.generate()

  return dun
}

function isSolid (x, z) {
  x /= 2
  z /= 2
  z += 0.5
  x += 0.5
  if (x <= 0 || z <= 0 || x >= map.width || z >= map.depth) {
    return true
  }
  return !!map.get(Math.floor(x), 1, Math.floor(z))
}

function updateMobAI (world) {
  world.queryComponents([MobAI, Physics]).forEach(function (e) {
    var plr = world.queryTag('player')[0]
    var dx = plr.physics.pos.x - e.physics.pos.x
    var dz = plr.physics.pos.z - e.physics.pos.z
    var dist = Math.sqrt(dx*dx + dz*dz)
    dx /= dist
    dz /= dist
    e.physics.vel.x += dx * 0.002
    e.physics.vel.z += dz * 0.002
  })
}

function updatePhysics (world) {
  world.queryComponents([Physics]).forEach(function (e) {
    // gravity
    e.physics.vel.y -= 0.006

    // wall collisions; test x and z separately
    var tx = e.physics.pos.x + e.physics.vel.x
    if (isSolid(tx, e.physics.pos.z)) {
      e.physics.vel.x *= -0.3
    }
    var tz = e.physics.pos.z + e.physics.vel.z
    if (isSolid(e.physics.pos.x, tz)) {
      e.physics.vel.z *= -0.3
    }

    // newtonian physics
    e.physics.pos.x += e.physics.vel.x
    e.physics.pos.y += e.physics.vel.y
    e.physics.pos.z += e.physics.vel.z

    // ground collision
    var onGround = false
    if (e.physics.pos.y - e.physics.height/2 <= 1) {
      e.physics.vel.y *= -0.3
      e.physics.pos.y = 1 + e.physics.height/2
      onGround = true
    }

    // ceiling collision
    if (e.physics.pos.y >= 5) {
      e.physics.vel.y *= -0.3
      e.physics.pos.y = 5
    }

    // ground friction
    if (onGround) {
      e.physics.vel.x *= e.physics.friction
      e.physics.vel.z *= e.physics.friction
    }
  })
}

function updateCamera (world) {
  world.queryComponents([CameraController]).forEach(function (e) {
    camera.pos[0] = -e.physics.pos.x
    camera.pos[1] = -e.physics.pos.y
    camera.pos[2] = -e.physics.pos.z

    if (key('<up>')) {
      e.physics.vel.z -= Math.cos(camera.rot[1]) * 0.01
      e.physics.vel.x += Math.sin(camera.rot[1]) * 0.01
    }
    if (key('<down>')) {
      e.physics.vel.z += Math.cos(camera.rot[1]) * 0.01
      e.physics.vel.x -= Math.sin(camera.rot[1]) * 0.01
    }
    if (key('<right>')) {
      camera.rot[1] += 0.03
    }
    if (key('<left>')) {
      camera.rot[1] -= 0.03
    }
  })
}

function run (assets) {
  var accum = 0
  var frames = 0
  var last = new Date().getTime()

  var player = world.createEntity()
  player.addComponent(Physics)
  player.addComponent(CameraController)
  player.addTag('player')

  var foe = world.createEntity()
  foe.addComponent(Physics)
  foe.addComponent(MobAI)
  foe.physics.height = 2
  foe.physics.pos.x = 12
  foe.physics.pos.z = 12
  foe.physics.pos.y = 5

  // alloc + config map
  map = new Voxel(regl, 50, 10, 50, assets.atlas)
  var dun = generateLevel(25, 25)
  for (var i=0; i < map.width; i++) {
    for (var j=0; j < map.depth; j++) {
      for (var k=0; k < map.height; k++) {
        if (k >= 1 && k <= 2) {
          var x = Math.floor(i / 2)
          var y = Math.floor(j / 2)
          map.set(i, k, j, dun.walls.get([x, y]) ? 1 : 0)
        } else {
          map.set(i, k, j, 1)
        }
      }
    }
  }

  // var p = dun.children[Math.floor(Math.random() * dun.children.length)]
  // player.physics.pos.x = (p.position[0] + p.room_size[0]/2) * 2 + 0.5
  // player.physics.pos.z = (p.position[1] + p.room_size[1]/2) * 2 + 0.5
  var room = dun.initial_room
  player.physics.pos.x = (room.position[0] + room.size[0]) * 2
  player.physics.pos.z = (room.position[1] + room.size[1]) * 2
  player.physics.pos.y = 4
  camera.rot[1] = -Math.PI
  // console.log(p.position, p.size)

  map.generateGeometry()

  // default darkness
  for (var i=0; i < map.width; i++) {
    for (var j=0; j < map.depth; j++) {
      for (var k=0; k < map.height; k++) {
        map.lightBoxSet(i, k, j, function (pos, normal) {
          return [0.1, 0.1, 0.1]
        })
      }
    }
  }

  function updateLights (lights) {
    for (var i=0; i < map.width; i++) {
      for (var j=0; j < map.depth; j++) {
        for (var k=0; k < map.height; k++) {
          lights.forEach(function (light) {
            var lightPos = vec3.fromValues(light.pos.x, light.pos.y, light.pos.z)
            map.lightBoxAdd(i, k, j, function (pos, normal) {
              var br = pointLight(lightPos, light.intensity, pos, normal)
              return [br * 226/255, br * 188/255, br * 134/255]
            })
          })
        }
      }
    }
  }

  var view = mat4.lookAt([],
                        [0, 0, -30],
                        [0, 0.0, 0],
                        [0, 1, 0])

  var sky = Sky(regl)

  var chr = Billboard(regl, 2)

  var text = Text(regl, 'MONSTER HUNGRY')

  function drawBillboard (state, x, y, z, texture) {
    var model = mat4.create()
    mat4.identity(model)
    mat4.translate(model, model, vec3.fromValues(x, y, z))
    mat4.scale(model, model, vec3.fromValues(1.0, 1.0, 1.0))
    var rot = -Math.atan2(-camera.pos[2] - z, -camera.pos[0] - x) + Math.PI/2
    mat4.rotateY(model, model, rot)
    chr({
      model: model,
      frame: state.tick % 70 < 35 ? 0 : 0.5,
      view: view,
      texture: texture
    })
  }

  function drawText (text, x, y, z) {
    var model = mat4.create()
    mat4.identity(model)
    mat4.translate(model, model, vec3.fromValues(x, y, z))
    mat4.scale(model, model, vec3.fromValues(1, -1, 1))
    var rot = -Math.atan2(-camera.pos[2] - z, -camera.pos[0] - x) + Math.PI/2
    mat4.rotateY(model, model, rot)
    text({
      projection: projection,
      view: view,
      model: model
    })
  }

  console.time('light')
  var lights = []
  dun.children.forEach(function (p) {
    lights.push({
      pos: {
        x: (p.position[0] + p.room_size[0]/2) * 2,
        y: 3,
        z: (p.position[1] + p.room_size[1]/2) * 2
      },
      intensity: Math.random() * 5 + 4
    })
  })
  updateLights(lights)
  console.timeEnd('light')

  document.body.onkeypress = function (ev) {
    var k = ev.key
    var txt = world.createEntity()
    txt.addComponent(Text3D)
    txt.addComponent(Physics)
    txt.text3D.generate(k)

    letters++
    lastLetter = new Date().getTime()

    var plr = world.queryTag('player')[0]
    var yrot = camera.rot[1] - 0.05 + letters*0.01
    txt.physics.pos.x = plr.physics.pos.x + Math.sin(yrot)
    txt.physics.pos.z = plr.physics.pos.z - Math.cos(yrot)
    txt.physics.pos.x += Math.sin(yrot + Math.PI/2) * 0.1
    txt.physics.pos.z -= Math.cos(yrot + Math.PI/2) * 0.1
    txt.physics.pos.y = 3
    txt.physics.vel.x = plr.physics.vel.x + Math.sin(yrot) * 0.8
    txt.physics.vel.z = plr.physics.vel.z - Math.cos(yrot) * 0.8
    txt.physics.vel.y = plr.physics.vel.y - Math.sin(camera.rot[0]) * 0.8 + 0.1
    txt.physics.height = 0.8
    txt.physics.width = 0.2
    txt.physics.depth = 0.2
    txt.physics.friction = 0.3
  }

  regl.frame(function (state) {
    accum += (new Date().getTime() - last)
    frames++
    if (accum >= 1000) {
      console.log(''+frames, 'FPS')
      frames = 0
      accum = 0
    }
    last = new Date().getTime()

    if (new Date().getTime() - lastLetter > 400) {
      letters = 0
    }

    systems.forEach(function (s) { s(world) })

    projection = mat4.perspective([],
                                  Math.PI / 3,
                                  state.viewportWidth / state.viewportHeight,
                                  0.01,
                                  1000)

    mat4.identity(view)
    mat4.rotateX(view, view, camera.rot[0])
    mat4.rotateY(view, view, camera.rot[1])
    mat4.rotateZ(view, view, camera.rot[2])
    mat4.translate(view, view, camera.pos)

    regl.clear({
      color: [0, 0, 0, 1],
      depth: 1
    })

    sky()

    map.draw({
      projection: projection,
      view: view
    })

    world.queryComponents([Text3D]).forEach(function (e) {
      drawText(e.text3D.draw, e.physics.pos.x, e.physics.pos.y, e.physics.pos.z)

      if (new Date().getTime() > e.text3D.expireTime) {
        e.remove()
        return
      }

      world.queryComponents([MobAI, Physics]).forEach(function (m) {
        var dx = m.physics.pos.x - e.physics.pos.x
        var dz = m.physics.pos.z - e.physics.pos.z
        var dist = Math.sqrt(dx*dx + dz*dz)
        if (dist < 1) {
          m.physics.vel.x += e.physics.vel.x * 0.1
          m.physics.vel.z += e.physics.vel.z * 0.1
          e.remove()
        }
      })
    })

    world.queryComponents([MobAI, Physics]).forEach(function (e) {
      drawBillboard(state, e.physics.pos.x, e.physics.pos.y, e.physics.pos.z, assets.foe)
    })
  })
}
