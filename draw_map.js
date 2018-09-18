class MapDraw {
    constructor(data) {
        this.data = data;
        this.font = font || 'Arial';
    }

    draw(layer) {
        console.log('drawing ' + layer);
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
        if (layer.indexOf('hoods') > -1) {
            this.draw_neighborhoods();
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
        /*
        push();
        for (var i = 0; i < this.data.population_peaks.length; i++) {
            fill((i/this.data.population_peaks.length) * 255);
            ellipse(this.data.population_peaks[i].x, this.data.population_peaks[i].y, 10, 10);
        }
        pop();
        */

        this.compass_rose();
        this.draw_scale();
    }

    draw_neighborhoods() {
        push();
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                if (!this.is_water(x, y) && this.color_border(x, y, this.get_neighborhood, 1)) {
                    stroke(black);
                    point(x, y);
                }
            }
        }
        pop();

        push();
        for (var i = 0; i < this.data.population_peaks.length; i++) {
            fill((i/this.data.population_peaks.length) * 255);
            ellipse(this.data.population_peaks[i].x, this.data.population_peaks[i].y, 10, 10);
        }
        pop();

        this.label_neighborhoods();
    }

    label_neighborhoods(labels) {
        labels = labels || [];
        for (var i = 0; i < this.data.neighborhood_centers.length; i++) {
            push();
            textSize(12);
            textFont(this.font);
            textAlign(CENTER);
            fill('#8392A7');
            strokeWeight(4);
            stroke(white);

            var x = this.data.neighborhood_centers[i].x;
            var y = this.data.neighborhood_centers[i].y;

            var name = i < labels.length ? labels[i] : 'Neighborhood ' + i;
            // check if label may be off the map
            // estimate label length
            var estimated_length = 4 * name.length;
            if (x < estimated_length) {
                x += estimated_length - x;
            }
            if (y === 0) {
                y += 30;
            }
            if (x >= width - estimated_length) {
                x -= estimated_length;
            }
            if (y >= height - 30) {
                y -= 30;
            }

            text(name.toUpperCase(), x, y);
            pop();
        }
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

                    var border_value = this.color_border(x, y, this.get_elevation, 50);
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

    color_border(x, y, func, granularity) {
        // checks if a point is in a different elevation "bucket" than its SE neighbors
        granularity = granularity || 50;
        for (var i = 0; i <= 1; i++) {
            for (var j = 0; j <= 1; j++) {
                if (this.on_map(x + i, y + j)) {
                    var elev1 = Math.floor(func.call(this, x, y) * granularity);
                    var elev2 = Math.floor(func.call(this, x + i, y + j) * granularity);
                    if (elev1 != elev2) {
                        return [func.call(this, x, y), func.call(this, x + i, y + j)];
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
            highway: '#FFE992',
            highway_shadow: '#F8D264',
            park: '#C0ECAE',
            beach: '#FAF2C7',
            text: '#8392A7',
        };
        push();
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var point_color = colors.ground;
                if (this.get_elevation(x, y) < 0) {
                    point_color = colors.water;
                } else if (this.data.beach[x][y]) {
                    point_color = colors.beach;
                } else if (this.data.parks[x][y]) {
                    point_color = colors.park;
                }
                stroke(point_color);
                point(x, y);
            }
        }
        pop();
        this.draw_roads(colors);
        this.label_roads();
        this.label_neighborhoods();
    }


    draw_roads(colors) {
        push();
        strokeWeight(3);
        if (colors !== undefined) {
            stroke(colors.road);
        }
        var highway_threshold = 27;
        if (colors !== undefined) {
            for (var i = 0; i < this.data.roads.length; i++) {
                var road = this.data.roads[i];
                var road_width = road.length > 3 ? 3 : 2;
                for (var j = 0; j < road.length; j++) {
                    push();
                    var shadow_color = road.length > highway_threshold ? colors.highway_shadow : colors.road_shadow;
                    stroke(shadow_color);
                    strokeCap(SQUARE);
                    strokeWeight(road_width + 2);
                    line(road[j][0].x, road[j][0].y, road[j][1].x, road[j][1].y);
                    pop();
                }
            }
        }
        // this has to be in a separate loop to get the layering right
        for (var i = 0; i < this.data.roads.length; i++) {
            if (colors === undefined) {
                stroke((i/this.data.roads.length) * 200);
            }
            var road = this.data.roads[i];
            var road_width = road.length > 3 ? 3 : 2;
            var road_color = road.length > highway_threshold ? colors.highway : colors.road;
            stroke(road_color);
            strokeWeight(road_width);
            for (var j = 0; j < road.length; j++) {
                line(road[j][0].x, road[j][0].y, road[j][1].x, road[j][1].y);
            }
        }
        pop();
    }

    draw_pins(landmarks) {
        var clickables = [];
        // arguably placement should happen in the compute step, but I dunno when I want to feed the map cultural data
        for (var i = 0; i < landmarks.length; i++) {
            // pick a random location
            var placement = this.data.roads[int(random(0, this.data.roads.length))];
            // I'd like to extract the street id here
            placement = placement[int(random(0, placement.length))][1];

            // draw a pin
            push();
            fill('#f00');
            bezier(placement.x, placement.y,
                   placement.x + 25, placement.y - 30,
                   placement.x - 25, placement.y - 30,
                   placement.x, placement.y);
            pop();
            var pin = [
                {x: placement.x - 20, y: placement.y},
                {x: placement.x + 20, y: placement.y - 30}];
            pin.id = i;
            pin.name = landmarks[i].name;
            clickables.push(pin);
        }
        return clickables;
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

    label_roads(labels) {
        // however I'm using rotate and translate just royally fucks the whole canvas
        labels = labels || [];
        var theta = 0;
        for (var i = 0; i < this.data.roads.length; i++) {
            var road = this.data.roads[i];
            if (road.length < 20) continue;

            push();
            //rotate(TWO_PI - theta);
            textSize(8);
            textFont(this.font);
            textAlign(CENTER);
            fill('#737D83');
            strokeWeight(3);
            stroke(white);

            road = road[int(road.length / 2)];
            translate(road[0].x, road[0].y);
            theta = atan2(road[1].y - road[0].y, road[1].x - road[0].x);
            if (theta > PI/2 || theta < - 1 * HALF_PI) theta += PI;
            rotate(theta);
            var name = i < labels.length ? labels[i] : 'road ' + i;
            text(name, 0, 0);

            pop();
        }
    }


    is_water(x, y) {
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


    get_population_density(x, y) {
        x = Math.round(x);
        y = Math.round(y);
        if (this.on_map(x, y)) {
            return this.data.population_density[x][y];
        }
    }


    get_neighborhood(x, y) {
        x = Math.round(x);
        y = Math.round(y);
        if (this.on_map(x, y)) {
            return this.data.neighborhoods[x][y];
        }
    }


    on_map(x, y) {
        // is the point on the map?
        return x >= 0 && y >= 0 && x < width && y < height;
    }
}
