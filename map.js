var black;
var white;

function setup() {
    var container = document.getElementById('map');
    var canvas = createCanvas(600, 300);
    canvas.parent(container);

    // parse URL get params
    var param_string = window.location.search.substr(1).split('&');
    var params = {};
    for (var i = 0; i < param_string.length; i++) {
        var pair = param_string[i].split('=');
        params[pair[0]] = pair[1];
    }
    var seed = params.seed || Math.floor(Math.random() * 10000);
    var layer = params.layer || 'topo';
    console.log(seed);

    // establish color globals now that things are initialized
    black = color(0);
    white = color(255);

    var map = new MapData(seed, params);
    var data = map.compute_map();
    var drawer = new MapDraw(data);
    drawer.draw(layer);

    noLoop();
}

