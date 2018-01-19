var black;

function setup() {
    var container = document.getElementById('map');
    var canvas = createCanvas(640, 360);
    canvas.parent(container);

    var seed = container.getAttribute('data-seed');
    black = color(0);

    var map = new Map(seed);
    map.draw_map();

    noLoop();
}

class Map {
    constructor(seed) {
        this.seed = seed || (new Date).getTime();
        randomSeed(this.seed);

        // I don't know WHAT the deal is with p5 noise() so we're using this instead
        var gen = new SimplexNoise(random);
        this.get_noise = function (nx, ny) {
          // Rescale from -1.0:+1.0 to 0.0:1.0
          return gen.noise2D(nx, ny) / 2 + 0.5;
        }

        this.elevation = this.create_matrix();

        this.colors = {
            water: '#A9DCE0',
            topo: ['#C1CCA5', '#C1CCA5', '#E6F0BF', '#E9EFB5', '#DAC689', '#CDA37F', '#CB9082', '#C8BEC6', '#D6D5E5'],
        };
    }

    draw_map() {
        // ----- compute elements ----- \\
        this.get_topography();

        var color_gap = 5;
        // ----- draw map ------------- \\
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                // bucketize for topo map
                var value = Math.floor(this.elevation[x][y] * 100);
                var color_bucket = Math.floor(value / color_gap);
                if (color_bucket >= this.colors.topo.length) {
                    color_bucket = this.colors.topo.length - 1;
                }
                var point_color = this.colors.topo[color_bucket];

                var border_value = this.topo_border(x, y);
                if (!!border_value) {
                    var bucket1 = Math.floor(border_value[0] * 100 / color_gap);
                    var bucket2 = Math.floor(border_value[1] * 100 / color_gap);

                    point_color = bucket1 != bucket2 ? 0 : lerpColor(color(point_color), black, 0.3);
                }
                stroke(point_color);
                point(x, y);
            }
        }
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

    get_topography() {
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
                noise_value = Math.pow(noise_value, 2); // flatens out the lows

                this.elevation[x][y] = noise_value;
            }
        }
    }

    create_matrix() {
        var matrix = [];
        for (var x = 0; x < width; x++) {
            matrix[x] = new Array(height);
        }
        return matrix;
    }
}


