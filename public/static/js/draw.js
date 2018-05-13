// code for drawing a map based on data from server. expects an object of layers
var black;
var white;

function setup() {
    var container = document.getElementById('map');
    var canvas = createCanvas(data.width, data.height);
    canvas.parent(container);

    // parse URL get params
    var param_string = window.location.search.substr(1).split('&');
    var params = {};
    for (var i = 0; i < param_string.length; i++) {
        var pair = param_string[i].split('=');
        params[pair[0]] = pair[1];
    }
    var layer = params.layer || 'topo';

    // establish color globals now that things are initialized
    black = color(0);
    white = color(255);

    draw_map(layer);

    noLoop();
}

function draw_map(layer) {
    // ----- draw map ------------- \\
    if (layer.indexOf('topo') > -1) {
        draw_topo();
    } else if (layer.indexOf('population') > -1) {
        draw_population();
    } else if (layer.indexOf('urban') > -1) {
        draw_urban();
    }

    if (layer.indexOf('roads') > -1) {
        draw_roads();
    }

    compass_rose();
    draw_scale();
}

function draw_cmqtt(tree) {
    // visualizer for debugging the ConnorMouseQuadtreeTree data strucutre
    tree = tree || data.roads;
    // traverse cmqtt to get all the rects and segments
    push();
    noFill();
    stroke(black);
    rect(tree.x, tree.y, tree.width, tree.height);
    pop()
    for (var c = 0; c < tree.children.length; c++) {
        if (tree.children[c] instanceof ConnorMouseQuadtreeTree) {
            draw_cmqtt(tree.children[c]);
        } else {
            line(tree.children[c].p1.x, tree.children[c].p1.y, tree.children[c].p2.x, tree.children[c].p2.y);
        }
    }
}

function draw_population() {
    // density map
    var color_gap = 5;
    var colors = {
        water: '#A9DCE0',
    };
    push();
    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var point_color;
            if (is_water(x, y)) {
                point_color = colors.water;
            } else {
                point_color = 255 - (255 * get_population_density(x, y));
                point_color = point_color > 255 ? 255 : point_color;
                point_color = point_color < 0 ? 0 : point_color;
                point_color += point_color * 0.1;
            }
            stroke(point_color, point_color, 255);
            point(x, y);
        }
    }
    pop();
}

function draw_topo() {
    // topo map
    var color_gap = 5;
    var colors = {
        water: '#A9DCE0',
        topo: ['#C1CCA5', '#C1CCA5', '#E6F0BF', '#E9EFB5', '#DAC689', '#CDA37F', '#CB9082', '#C8BEC6', '#D6D5E5'],
    };
    push();
    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var point_color;
            if (get_elevation(x, y) < 0) {
                point_color = colors.water;
            } else {
                // bucketize for topo map
                var value = Math.floor(get_elevation(x, y) * 100);
                var color_bucket = Math.floor(value / color_gap);
                if (color_bucket >= colors.topo.length) {
                    color_bucket = colors.topo.length - 1;
                }
                point_color = colors.topo[color_bucket];

                var border_value = topo_border(x, y);
                if (!!border_value) {
                    var bucket1 = Math.floor(border_value[0] * 100 / color_gap);
                    var bucket2 = Math.floor(border_value[1] * 100 / color_gap);

                    point_color = bucket1 != bucket2 ? 0 : lerpColor(color(point_color), black, 0.3);
                }
            }
            stroke(point_color);
            point(x, y);
        }
    }
    pop();
}

function topo_border(x, y) {
    // checks if a point is in a different elevation "bucket" than its SE neighbors
    var granularity = 50;
    for (var i = 0; i <= 1; i++) {
        for (var j = 0; j <= 1; j++) {
            if (on_map(x + i, y + j)) {
                var elev1 = Math.floor(get_elevation(x, y) * granularity);
                var elev2 = Math.floor(get_elevation(x + i, y + j) * granularity);
                if (elev1 != elev2) {
                    return [get_elevation(x, y), get_elevation(x + i, y + j)];
                }
            }
        }
    }
    return false;
}

function draw_urban() {
    // topo map
    var color_gap = 5;
    var colors = {
        water: '#AADBFF',
        ground: '#E8E8E8',
        road_shadow: '#E5E5E5',
        road: '#FFFFFF',
    };
    push();
    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var point_color = get_elevation(x, y) < 0 ? colors.water : colors.ground;
            stroke(point_color);
            point(x, y);
        }
    }
    pop();
    draw_roads(colors);
}

function draw_roads(colors) {
    push();
    strokeWeight(3);
    if (colors !== undefined) {
        stroke(colors.road);
    }
    if (colors !== undefined) {
        for (var i = 0; i < data.roads.length; i++) {
            var road = data.roads[i];
            var segment_length = get_distance(road[road.length - 2], road[road.length - 1]);
            var road_width = 2;//TODO segment_length < data.min_segment_length * 2 ? 2 : 3;
            for (var j = 0; j < road.length - 1; j++) {
                push();
                stroke(colors.road_shadow);
                strokeCap(SQUARE);
                strokeWeight(road_width + 2);
                line(road[j].x, road[j].y, road[j + 1].x, road[j + 1].y);
                pop();
            }
        }
    }
    for (var i = 0; i < data.roads.length; i++) {
        if (colors === undefined) {
            stroke((i/data.roads.length) * 200);
        }
        var road = data.roads[i];
        var segment_length = get_distance(road[road.length - 2], road[road.length - 1]);
        var road_width = 2;//TODO segment_length < data.min_segment_length * 2 ? 2 : 3;
        strokeWeight(road_width);
        for (var j = 0; j < road.length - 1; j++) {
            line(road[j].x, road[j].y, road[j + 1].x, road[j + 1].y);
        }
    }
    pop();
}

function draw_scale() {
    // draws the black and white scale indicator at the bottom of the map
    push();
    var r_height = 7;
    var r_width = 50;
    var offset = 220;

    stroke(black);
    textSize(9);

    var fill_color = black;
    text('0 miles', width - offset, height - 25);
    for (var i = 0; i < 4; i++) {
        fill_color = fill_color == white ? black : white;
        fill(fill_color);
        rect(width - offset, height - 20, r_width, r_height);
        offset -= 50;

        fill(black);
        var dist = (0.5 * (i + 1)).toString();
        // "2" -> "2.0"
        dist = (dist).replace(/^((?!0)\d)+(?!\.(?!\d))$/, '$1.0');
        text(dist, width - offset - 5, height - 25);
    }
    pop();
}

function compass_rose() {
    // draws a simple compass rose
    push();
    textSize(25);
    textFont('Georgia');
    fill(black);
    text('N', 20, height - 20);
    beginShape();
    vertex(22, height - 50);
    vertex(30, height - 80);
    vertex(38, height - 50);
    vertex(30, height - 60);
    endShape(CLOSE);
    pop();
}


// utility functions
function get_distance(p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2))
}

function is_water(x, y, radius) {
    if (radius) {
        for (var a = 0; a < 2 * Math.PI; a += Math.PI / 6) {
            for (var r = 0; r < radius; r++) {
                var nx = x + r * Math.cos(a)
                var ny = y + r * Math.sin(a)
                if (this.get_elevation(nx, ny) < 0) {
                    return true
                }
            }
        }
    }
    return this.get_elevation(x, y) < 0
}

function get_population_density(x, y) {
    x = Math.round(x)
    y = Math.round(y)
    if (this.on_map(x, y)) {
        return data.population_density[x][y]
    }
}

function get_elevation(x, y) {
    // making this a function so that it can be swapped out or used
    // with elevation modifiers
    x = Math.round(x)
    y = Math.round(y)
    if (on_map(x, y)) {
        return data.elevation[x][y]
    }
}

function on_map(x, y) {
    // is the point on the map?
    return x >= 0 && y >= 0 && x < width && y < height;
}
