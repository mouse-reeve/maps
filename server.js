const express = require('express')
const map_builder = require('./map.js');
const app = express()

app.get('/', function(request, response) {
    params = request.query
    var map = new map_builder(123, params);
    return response.json(map)
})
app.listen(2000, () => console.log('Mappapp running on port 2000'))

