var black;
var white;
var map;
var drawer;


function setup() {
    var container = document.getElementById('map');
    var canvas = createCanvas(850, 400);
    canvas.parent(container);

    var params = {};
    // serialize form data (the last item in the list is "submit")
    if (!!form_params[0].checked) {
        for (var i = 1; i < form_params.length - 1; i++) {
            var key = form_params[i].name;
            var value = form_params[i].value;
            params[key] = value;
        }
    } else {
        // parse URL get params
        var param_string = window.location.search.substr(1).split('&');
        for (var i = 0; i < param_string.length; i++) {
            var pair = param_string[i].split('=');
            params[pair[0]] = pair[1];
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

