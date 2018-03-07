const express = require('express')
const map_builder = require('./map.js');
const app = express()

app.get('/', (request, response) => response.json(load_map()))
app.listen(2000, () => console.log('Mappapp running on port 2000'))

function load_map() {
    return new map_builder()
}
