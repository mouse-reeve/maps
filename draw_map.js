class MapDraw {
    constructor(data) {
        this.data = data;
    }

    draw(layer) {
        // ----- draw map ------------- \\
        if (layer.indexOf('topo') > -1) {
            this.draw_topo();
        } else if (layer.indexOf('population') > -1) {
            this.draw_population();
        } else if (layer.indexOf('urban') > -1) {
            this.draw_urban();
        } else if (layer.indexOf('cmqtt') > -1) {
            this.draw_cmqtt();
        }
        if (layer.indexOf('roads') > -1) {
            this.draw_roads();
        }

        /* Handy for debugging the coast algorithms
        push();
        noFill();
        for (var i = 0; i < this.data.coastline.length; i++) {
            ellipse(this.data.coastline[i][0], this.data.coastline[i][1], 5, 5);
        }
        pop()
        */

        /* for debugging rivers
        push();
        for (var i = 0; i < this.data.riverline.length; i++) {
            fill((i/this.data.riverline.length) * 255);
            ellipse(this.data.riverline[i][0], this.data.riverline[i][1], 10, 10);
        }
        pop()
        */
        // for debugging neighborhoods
        push();
        for (var i = 0; i < this.data.population_peaks.length; i++) {
            fill((i/this.data.population_peaks.length) * 255);
            ellipse(this.data.population_peaks[i].x, this.data.population_peaks[i].y, 10, 10);
        }
        pop();
        //*/

        this.compass_rose();
        this.draw_scale();
    }

    draw_cmqtt(tree) {
        // visualizer for debugging the ConnorMouseQuadtreeTree data strucutre
        tree = tree || this.data.roads_cmqtt;
        // traverse cmqtt to get all the rects and segments
        push();
        noFill();
        stroke(black);
        rect(tree.x, tree.y, tree.width, tree.height);
        pop();
        for (var c = 0; c < tree.children.length; c++) {
            if (tree.children[c] instanceof ConnorMouseQuadtreeTree) {
                this.draw_cmqtt(tree.children[c]);
            } else {
                line(tree.children[c].p1.x, tree.children[c].p1.y, tree.children[c].p2.x, tree.children[c].p2.y);
            }
        }
    }

    draw_population() {
        // density map
        var color_gap = 5;
        var colors = {
            water: '#A9DCE0',
        };
        push();
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var point_color;
                if (this.is_water(x, y)) {
                    point_color = colors.water;
                } else {
                    point_color = 255 - (255 * this.get_population_density(x, y));
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

    draw_topo() {
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
                if (this.get_elevation(x, y) < 0) {
                    point_color = colors.water;
                } else {
                    // bucketize for topo map
                    var value = Math.floor(this.get_elevation(x, y) * 100);
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
        pop();
    }

    topo_border(x, y) {
        // checks if a point is in a different elevation "bucket" than its SE neighbors
        var granularity = 50;
        for (var i = 0; i <= 1; i++) {
            for (var j = 0; j <= 1; j++) {
                if (this.on_map(x + i, y + j)) {
                    var elev1 = Math.floor(this.get_elevation(x, y) * granularity);
                    var elev2 = Math.floor(this.get_elevation(x + i, y + j) * granularity);
                    if (elev1 != elev2) {
                        return [this.get_elevation(x, y), this.get_elevation(x + i, y + j)];
                    }
                }
            }
        }
        return false;
    }

    draw_urban() {
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
                var point_color = this.get_elevation(x, y) < 0 ? colors.water : colors.ground;
                stroke(point_color);
                point(x, y);
            }
        }
        pop();
        this.draw_roads(colors);
    }


    draw_roads(colors) {
        push();
        strokeWeight(3);
        if (colors !== undefined) {
            stroke(colors.road);
        }
        if (colors !== undefined) {
            for (var i = 0; i < this.data.roads.length; i++) {
                var road = this.data.roads[i];
                var segment_length = get_distance(road[road.length - 2], road[road.length - 1]);
                var road_width = segment_length < this.data.min_segment_length * 2 ? 2 : 3;
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
        for (var i = 0; i < this.data.roads.length; i++) {
            if (colors === undefined) {
                stroke((i/this.data.roads.length) * 200);
            }
            var road = this.data.roads[i];
            var segment_length = get_distance(road[road.length - 2], road[road.length - 1]);
            var road_width = segment_length < this.data.min_segment_length * 2 ? 2 : 3;
            strokeWeight(road_width);
            for (var j = 0; j < road.length - 1; j++) {
                line(road[j].x, road[j].y, road[j + 1].x, road[j + 1].y);
            }
        }
        pop();
    }

    compass_rose() {
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


    draw_scale() {
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


    is_water(x, y, radius) {
        if (radius) {
            for (var a = 0; a < TWO_PI; a += PI / 6) {
                for (var r = 0; r < radius; r++) {
                    var nx = x + r * cos(a);
                    var ny = y + r * sin(a);
                    if (this.get_elevation(nx, ny) < 0) {
                        return true;
                    }
                }
            }
        }
        return this.get_elevation(x, y) < 0;
    }


    get_elevation(x, y) {
        // making this a function so that it can be swapped out or used
        // with elevation modifiers
        x = Math.round(x);
        y = Math.round(y);
        if (this.on_map(x, y)) {
            return this.data.elevation[x][y];
        }
    }

    on_map(x, y) {
        // is the point on the map?
        return x >= 0 && y >= 0 && x < width && y < height;
    }


    get_population_density(x, y) {
        x = Math.round(x);
        y = Math.round(y);
        if (this.on_map(x, y)) {
            return this.data.population_density[x][y];
        }
    }

}
