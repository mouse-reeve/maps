var black;
var white;

function setup() {
    var container = document.getElementById('map');
    var canvas = createCanvas(800, 600);
    canvas.parent(container);

    var seed = container.getAttribute('data-seed');
    black = color(0);
    white = color(255);

    var map = new Map(seed);
    map.draw_map();

    noLoop();
}

class Map {
    constructor(seed) {
        seed = seed || (new Date).getTime();
        randomSeed(seed);

        // I don't know WHAT the deal is with p5 noise() so we're using this instead
        var gen = new SimplexNoise(random);
        this.get_noise = function (nx, ny) {
          // Rescale from -1.0:+1.0 to 0.0:1.0
          return gen.noise2D(nx, ny) / 2 + 0.5;
        }

        this.elevation = this.create_matrix();
        this.water = this.create_matrix();
    }

    draw_map() {
        // ----- compute elements ----- \\
        this.get_elevation();
        this.get_coastline();

        var color_gap = 5;
        // ----- draw map ------------- \\
        // topo map
        var colors = {
            water: '#A9DCE0',
            topo: ['#C1CCA5', '#C1CCA5', '#E6F0BF', '#E9EFB5', '#DAC689', '#CDA37F', '#CB9082', '#C8BEC6', '#D6D5E5'],
        };
        push();
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var point_color;
                if (!!this.water[x][y]) {
                    point_color = colors.water;
                } else {
                    // bucketize for topo map
                    var value = Math.floor(this.elevation[x][y] * 100);
                    var color_bucket = Math.floor(value / color_gap);
                    if (color_bucket >= colors.topo.length) {
                        color_bucket = colors.topo.length - 1;
                    }
                    point_color = colors.topo[color_bucket];

                    var border_value = this.topo_border(x, y);
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
        pop()
        push();
        var path = this.coastline;
        for (var i = 0; i < path.length; i++) {
            fill((255 / path.length) * i);
            ellipse(path[i][0], path[i][1], 10, 10);
        }
        pop()

        this.compass_rose();
        this.draw_scale();


    }

    topo_border(x, y) {
        var granularity = 50;
        for (var i = 0; i <= 1; i++) {
            for (var j = 0; j <= 1; j++) {
                if (x + i >= 0 && x + i < width && y + j >= 0 && y + j < height) {
                    var elev1 = Math.floor(this.elevation[x][y] * granularity);
                    var elev2 = Math.floor(this.elevation[x + i][y + j] * granularity);
                    if (elev1 != elev2) {
                        return [this.elevation[x][y], this.elevation[x + i][y + j]];
                    }
                }
            }
        }
        return false;
    }

    get_elevation() {
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                // higher number -> "zoom out"
                var frequency = 3 / width;

                var nx = x * frequency - 0.5;
                var ny = y * frequency - 0.5;

                // noisiness of edges
                var octaves = 3;

                var noise_value = 0;
                var divisor = 1;
                for (var i = 1; i <= octaves; i = i * 2) {
                    noise_value += 1 / i * this.get_noise(i * nx, i * ny);
                    divisor += 1 / i;
                }
                noise_value = noise_value / divisor; // keeps the value between 0 and 1
                noise_value = Math.pow(noise_value, 1.5); // flatens out the lows

                this.elevation[x][y] = noise_value;
            }
        }
    }

    get_coastline() {
        // Pick start and end coords
        var start = [Math.round(width * random(0.2, 0.7)), height - 1];
        var low = [start[0], start[1], 1];
        for (var i = 0; i < 100; i++) {
            var current_elevation = this.elevation[start[0] + i][height - 1];
            if (current_elevation < low[2]) {
                low = [start[0] + i, height - 1, current_elevation];
            }
        }
        start = [low[0], low[1]];

        var end = [width - 1, Math.round(height * random(0.5, 0.7))];
        low = [end[0], end[1], 1];
        for (var i = 0; i < 100; i++) {
            var current_elevation = this.elevation[end[0]][end[1] + i];
            if (current_elevation < low[2]) {
                low = [end[0], end[1] + i, current_elevation];
            }
        }
        end = [low[0], low[1]];

        // add a displaced midpoint perpendicularly to the line segment
        this.coastline = this.displace_midpoint(0, 1, [start, end]);

        // add new midpoints between the terminals and the new midpoint
        // recursively subdivide lines
        // draw water points along this coord path
    }

    displace_midpoint(i1, i2, curve) {
        var start = curve[i1];
        var end = curve[i2];
        var segment_length = Math.sqrt(Math.pow(end[0] - start[0], 2) + Math.pow(end[1] - start[1], 2));
        if (segment_length < 10) {
            return curve;
        }
        var midpoint = [Math.round((start[0] + end[0]) / 2),
                        Math.round((start[1] + end[1]) / 2)];

        // equation of the perpendicular line is y = mx + b
        var m = -1 * (start[0] - end[0]) / (start[1] - end[1]);
        // b = y - mx
        var b = midpoint[1] - (m * midpoint[0])
        var x = midpoint[0];
        var y;

        var low = [midpoint[0], midpoint[1], this.elevation[midpoint[0]][midpoint[1]]];

        var offset = Math.round(segment_length / 10);
        for (var i = -0.75 * offset; i < offset; i++) {
            if (x + i >= width || x + i < 0) {
                continue;
            }
            var nx = Math.floor(x + i);
            y = Math.round((m * nx) + b);
            var elevation = this.elevation[nx][y];
            if (elevation < low[2]) {
                low = [nx, y, elevation];
            }
        }
        var displaced = [low[0], low[1]];

        if ((displaced[0] == end[0] && displaced[1] == end[1]) || (displaced[0] == start[0] && displaced[1] == start[1])) {
            console.log(start, end, displaced, midpoint);
            console.log('woopsy');
            displaced = midpoint;
        }

        curve.splice(i2, 0, displaced);
        curve = this.displace_midpoint(i2, i2 + 1, curve);
        return this.displace_midpoint(i1, i2, curve);
    }

    create_matrix() {
        var matrix = [];
        for (var x = 0; x < width; x++) {
            matrix[x] = new Array(height);
        }
        return matrix;
    }

    draw_scale() {
        push();
        var r_height = 7;
        var r_width = 50;
        var offset = 220;

        stroke(black)
        textSize(9);

        fill(white);
        rect(width - offset, height - 20, r_width, r_height);
        fill(black);
        text('0 miles', width - offset, height - 25);
        offset -= 50;
        text('0.5', width - offset - 5, height - 25);

        fill(black);
        rect(width - offset, height - 20, r_width, r_height);
        offset -= 50;
        text('1.0', width - offset - 5, height - 25);

        fill(white);
        rect(width - offset, height - 20, r_width, r_height);
        offset -= 50;

        fill(black);
        text('1.5', width - offset - 5, height - 25);
        rect(width - offset, height - 20, r_width, r_height);
        offset -= 50;
        text('2.0', width - offset - 5, height - 25);
        pop();
    }

    compass_rose() {
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
}


