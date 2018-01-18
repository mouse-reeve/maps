var black, white;

function setup() {
    black = color('#000');
    white = color('#FFF');

    var canvas = createCanvas(600, 400);
    var container = document.getElementById('map');
    canvas.parent(container);

    var seed = container.getAttribute('data-seed');

    var map = new Map(text, seed);
    map.draw_map();

    noLoop();
}

class Map {
    constructor(text, seed) {
        this.seed = seed || (new Date).getTime();
        this.resolution = 10;
        this.grid = [];
        randomSeed(this.seed);
    }

    draw_map() {
        for (var i = 0; i < width; i += this.resolution) {
            this.grid[i] = [];
            for (var j = 0; j < height; j += this.resolution) {
                var noise_value = noise(i, j);
                fill(noise_value * 255);
                noStroke();
                this.grid[i][j] = noise_value;
                rect(i, j, this.resolution, this.resolution);
            }
        }
    }
}
