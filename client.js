// this is a simple test client, not meant to used for much
const express = require('express')
const http = require('http')
const hbs = require('express-handlebars')
const app = express()
app.engine( 'hbs', hbs( {
  extname: 'hbs',
  defaultLayout: 'index.html',
  layoutsDir: __dirname + '/views/',
} ) )
app.set( 'view engine', 'hbs' )

app.get('/', function(request, response) {
    console.log('received request')
    // passes the exact same url params to the map server
    var url = 'http://localhost:2000' + request.url

    http.get(url, (res) => {
        console.log('receiving query to map server')
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk })
        res.on('end', () => {
            console.log('ingesting map data')
            try {
                console.log('rendering template')
                return response.render('index', {data: rawData})
            } catch (e) {
                console.error(e.message);
            }
        });
    })
})
app.listen(2200, () => console.log('Map client running on port 2200'))

