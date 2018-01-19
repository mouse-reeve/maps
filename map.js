function setup() {

    var container = document.getElementById('map');
    var canvas = createCanvas(640, 360);
    canvas.parent(container);

    var seed = container.getAttribute('data-seed');

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
    }

    draw_map() {
        // ----- compute elements ----- \\
        this.get_topography();

        // ----- draw map ------------- \\
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var value = this.elevation[x][y] * 255;
                // bucketize for topo map
                value = value - value % 10;
                stroke(value);
                point(x, y);
            }
        }
    }

    get_topography() {
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var frequency = 2 / width;
                var nx = x * frequency - 0.5;
                var ny = y * frequency - 0.5;

                var octaves = 3;
                var noise_value = 0;
                var divisor = 1;
                for (var i = 1; i <= octaves; i = i * 2) {
                    noise_value += 1 / i * this.get_noise(i * nx, i * ny);
                    divisor += 1 / i;
                }
                noise_value = noise_value / divisor;
                noise_value = Math.pow(noise_value, 1.5);

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


