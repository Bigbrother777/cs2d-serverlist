const dgram = require('node:dgram')
const geoip = require('geoip-lite')
const server = dgram.createSocket('udp4')
const streams = require(__dirname + '/streams')
const usgnAddress = '81.169.236.243'
const usgnPort = 36963
let servers = []

function readFlag(flags, offset) {
  return !!(flags & (1 << offset))
}

function serverQuery(stream) {
  const res = {}
  let flags = stream.readByte()
  res.password = readFlag(flags, 0)
  res.usgnonly = readFlag(flags, 1)
  res.fow = readFlag(flags, 2)
  res.friendlyfire = readFlag(flags, 3)
  res.bots = readFlag(flags, 5)
  res.lua = readFlag(flags, 6)
  res.forcelight = readFlag(flags, 7)
  res.name = stream.readString(stream.readByte())
  res.map = stream.readString(stream.readByte())
  res.players = stream.readByte()
  res.maxplayers = stream.readByte()
  if (res.maxplayers == 0) return
  if (flags & 32) {
    res.gamemode = stream.readByte()
  } else {
    res.gamemode = 0
  }
  res.bots = stream.readByte()
  flags = stream.readByte()
  res.recoil = readFlag(flags, 0)
  res.offscreendamage = readFlag(flags, 1)
  res.hasdownloads = readFlag(flags, 2)
  res.playerlist = []
  const playerNum = stream.readByte(2)
  for (let i = 0; i < playerNum; i++) {
    res.playerlist.push({
      id: stream.readByte(),
      name: stream.readString(stream.readByte()),
      team: stream.readByte(),
      score: stream.readInt(),
      deaths: stream.readInt()
    })
  }
  return res
}

function receivedServerlist(stream) {
  if (stream.readByte() != 20) {
    return
  }
  const serverNum = stream.readShort()
  for (let i = 0; i < serverNum; i++) {
    const oct4 = stream.readByte()
    const oct3 = stream.readByte()
    const oct2 = stream.readByte()
    const oct1 = stream.readByte()
    const port = stream.readShort()
    const ip = `${oct1}.${oct2}.${oct3}.${oct4}`
    const exists = servers.find(obj => obj.ip === ip && obj.port === port)
    if (!exists) {
      const country = geoip.lookup(ip).country.toLowerCase()
      servers.push({ ip, port, country })
    }
  }
}

function receivedServerquery(stream, ip, port) {
  if (stream.readByte() != 251 || stream.readByte() != 1) {
    return
  }
  const data = serverQuery(stream)
  if (typeof data !== 'object') {
    return
  }
  const index = servers.findIndex(obj => obj.ip === ip && obj.port === port)
  if (!index) {
    return
  }
  servers[index] = {
    ...servers[index],
    ...data,
    ts: Math.floor(Date.now() / 1000)
  }
}

function validateIPPortFormat(input) {
  const ipPortRegex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5})$/
  return ipPortRegex.test(input)
}

server.on('message', (buf, rinfo) => {
  const stream = new streams(buf)
  if (stream.readShort() != 1) {
    return
  }
  if (rinfo.port == usgnPort && rinfo.address == usgnAddress) {
    receivedServerlist(stream)
  } else {
    receivedServerquery(stream, rinfo.address, rinfo.port)
  }
})

// Every 60 seconds
function serverlistRequest() {
  const ts = Math.floor(Date.now() / 1000)
  servers = servers.filter((e) => e.ts === undefined || (ts - e.ts) < 60)
  console.log(`Sending serverlist request`)
  server.send(Buffer.from([1, 0, 20, 1]), usgnPort, usgnAddress)
  setTimeout(serverlistRequest, 60000)
}
serverlistRequest()

// Every 15 seconds
function serverqueryRequest() {
  console.log(`Sending serverquery requests`)
  for (const e of servers) {
    server.send(Buffer.from([1, 0, 251, 1, 245, 3, 251, 5]), e.port, e.ip)
  }
  setTimeout(serverqueryRequest, 15000)
}
setTimeout(serverqueryRequest, 1000)

module.exports = {
  getData: function () {
    const ts = Math.floor(Date.now() / 1000)
    const filteredServers = servers.filter((e) => e.ts !== undefined && ts - e.ts < 60)
    const players = filteredServers.reduce((totalPlayers, server) => totalPlayers + (server.players - server.bots), 0)
    filteredServers.sort((a, b) => b.players - b.bots - (a.players - a.bots))
    return {
      servers: filteredServers,
      players: players
    }
  },
  getServer: function (addr) {
    if (addr === undefined) {
      return servers.find(server => server.hasOwnProperty('ts'))
    }
    if (!validateIPPortFormat(addr)) {
      return { error: 'Invalid address' }
    }
    const parts = addr.split(':')
    const server = servers.find((obj) => obj.ip === parts[0] && obj.port === parseInt(parts[1]))
    if (!server || server.ts === undefined) {
      return { error: 'Server does not exist' }
    }
    server.playerlist.sort((a, b) => b.score - a.score)
    return server    
  }
}
