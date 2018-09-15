var black;
var white;
var map;
var drawer;
var pins;
var font;

function preload() {
    font = loadFont('assets/Roboto-Regular.ttf');
}

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
        if (pair[1] !== undefined && form_params[i]) {
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

    var sample_pins = [
        {'name': 'Restaurant',
         'description': 'A local favorite'},
        {'name': 'Bath house',
         'description': 'A historical sauna'},
    ];
    pins = drawer.draw_pins(sample_pins);

    noLoop();
}

function mouseClicked() {
    if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;
    // check if a pin was clicked
    for (var i = 0; i < pins.length; i++) {
        var pin = pins[i];
        if ((mouseX > pin[0].x && mouseX < pin[1].x) &&
            (mouseY > pin[1].y && mouseY < pin[0].y)) {
            showPin(pin);
        }
    }
}

function showPin(pin) {
    var modal = document.getElementById('pin');
    modal.style.display = 'block';
    modal.style.top = pin[1].y;
    modal.style.left = pin[1].x;
    document.getElementById('pin-name').innerHTML = pin.name;
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
                value = float(value);
                value = Math.round(value * 100) / 100.0;
            }
            form_params[i].value = value;
        }
    }
}
