var black;
var white;
var map;
var drawer;

function setup() {
    var container = document.getElementById('map');
    var canvas = createCanvas(850, 400);
    canvas.parent(container);

    // parse URL get params
    var params = {};
    var param_string = window.location.search.substr(1).split('&');
    for (var i = 0; i < param_string.length; i++) {
        var pair = param_string[i].split('=');
        params[pair[0]] = pair[1];
        if (pair[1] !== undefined) {
            form_params[i].value = pair[1];
        }
    }

    var seed = params.seed || Math.floor(Math.random() * 10000);
    var layer = params.layer || 'topo';
    console.log(seed);

    // establish color globals now that things are initialized
    black = color(0);
    white = color(255);

    map = new MapData(seed, params);
    var data = map.compute_map();
    drawer = new MapDraw(data);
    drawer.draw(layer);

    noLoop();
}

function randomize() {
    for (var i = 0; i < form_params.length; i++) {
        var min = form_params[i].getAttribute('data-min');
        var max = form_params[i].getAttribute('data-max');
        var is_int = int(max) == float(max) && int(min) == float(min);
        if (max && min) {
            var value = random(float(min), float(max));
            if (is_int) {
                value = int(value);
            } else {
                value = Math.round(value * 100) / 100.0;
            }
            form_params[i].value = value;
        }
    }
}
