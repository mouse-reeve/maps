const express = require('express')
const map_builder = require('./map.js');
const app = express()

app.get('/', function(request, response) {
    params = request.query
    var seed = params.seed || (new Date).getTime()
    var map = new map_builder(seed, params)
    return response.json(map)
})
app.listen(2000, () => console.log('Mappapp running on port 2000'))

