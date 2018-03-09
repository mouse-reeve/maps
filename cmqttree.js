const max_leaves = 5;
const get_distance = require('./utilities')

class ConnorMouseQuadtreeTree {

    // (x, y) is the upper left hand corner
    constructor(x, y, w, h) {
        this.x = x;
        this.y = y;
        this.height = h;
        this.width = w;
        this.children = [];
    }

    insert(segment) {
        // check if it is in bounds
        segment.depth = segment.depth + 1 || 1;
        if (!segment.isInQuadrant({x: this.x, y: this.y}, this.width, this.height)) {
            return false;
        }

        if (this.is_branch()) {
            // check children
            for (var i = 0; i < this.children.length; i++) {
                // attempt inset into those points
                const ok = this.children[i].insert(segment);
            }
        } else {
            // attempt insert or subdivide
            if (this.children.length >= max_leaves) {
                this.subdivide(segment);
            }
            else {
                this.children.push(segment);
            }
        }
        return true;
    }

    subdivide(segment) {
        // include new child
        this.children.push(segment);

        var cmqtts = [];
        for (var x = this.x; x < this.x + this.width; x += this.width/2) {
            for (var y = this.y; y < this.y + this.height; y += this.height/2) {
                var cmqtt = new ConnorMouseQuadtreeTree(x, y, this.width/2, this.height/2);
                for (var c = this.children.length - 1; c >= 0; c--) {
                    var ok = cmqtt.insert(this.children[c]);

                    // remove child from parent quadtree if segment was inserted
                    if (ok) {
                        this.children.splice(c, 1);
                    }
                }
                // add the new ConnorMouseQuadtreeTree to the array if segments were successfully inserted
                cmqtts.push(cmqtt);
            }
        }

        // assign new quadtree children to parent quadtree
        this.children = cmqtts;
    }

    query(segment, radius) {
        var segments = [];

        // are the children of this ConnorMouseQuadtreeTree leafs or another CMQTT?
        if (!this.is_branch()) {

            // which children are within the radius?
            for (var c = 0; c < this.children.length; c++) {
                var child = this.children[c];

                // check if segment is within rectangular box around reference segment
                var isContained = child.isFuzzilyIntersecting(segment, radius);
                if (isContained)
                    segments.push(child);
            }
            return segments;
        }

        // if we are here, the children are quadtrees and we will query them
        // check if the segment is anywhere in this quardrant
        if (segment.isInQuadrant({x: this.x, y: this.y}, this.width, this.height)) {
            return segments;
        }

        for (var q = 0; q < this.children.length; q++) {
            segments.concat(this.children[q].query(segment, radius));
        }

        // dedupe
        var seenIds = {};
        var results = [];
        for (var s = 0; s < segments.length; s++) {
            if (segments[s].id in seenIds)
                continue;
            results.push(segments[s]);
            seenIds[segments[s].id] = true;
            seenIds[segments[s].id.split("").reverse().join("")] = true;
        }

        return results;
    }

    is_branch() {
        return this.children.length > 0 && this.children[0] instanceof ConnorMouseQuadtreeTree;
    }
}

class Segment {
    constructor(p1, p2) {
        this.id = `${p1.y},${p1.x},${p2.x},${p2.y}`;
        this.p1 = p1;
        this.p2 = p2;
        this.theta = Math.atan2(p1.y - p2.y, p1.x - p2.x);
        this.length = get_distance(p1, p2);
    }

    getPoint(idx) {
        return [this.p1, this.p2][idx];
    }

    isFuzzilyIntersecting(segment, radius) {
        // is whint ;)

        if (radius === 0) return this.segment_intersection(segment.p1, segment.p2, this.p1, this.p2);

        return this.isFuzzilyIntersectingRect(segment, radius) ||
               this.isFuzzilyIntersectingCircle(segment.p1, radius) ||
               this.isFuzzilyIntersectingCircle(segment.p2, radius);
    }

    isInQuadrant(origin, w, h, radius) {
        if (radius === undefined) radius = 0;
        return this.isFuzzilyIntersecting(new Segment(
            {x: origin.x - radius, y: origin.y + h/2},
            {x: origin.x + w + radius, y: origin.y + h/2},
        ), h/2 + radius);
    }

    isFuzzilyIntersectingRect(segment, radius) {
        // establish bounding points
        var p1 = {
            x: segment.p1.x + radius * Math.cos(segment.theta + Math.PI/2),
            y: segment.p1.y + radius * Math.sin(segment.theta + Math.PI/2),
        };
        var p2 = {
            x: segment.p2.x + radius * Math.cos(segment.theta + Math.PI/2),
            y: segment.p2.y + radius * Math.sin(segment.theta + Math.PI/2),
        };
        var p3 = {
            x: segment.p2.x - radius * Math.cos(segment.theta + Math.PI/2),
            y: segment.p2.y - radius * Math.sin(segment.theta + Math.PI/2),
        };
        var p4 = {
            x: segment.p1.x - radius * Math.cos(segment.theta + Math.PI/2),
            y: segment.p1.y - radius * Math.sin(segment.theta + Math.PI/2),
        };

        // construct bounding vectors of plane
        const bounds = [
            [p1, p2],
            [p2, p3],
            [p3, p4],
            [p4, p1],
        ];

        // lets raycast to figure out if the points are within the rectangular area!!!!!!!
        var maxX = [p1, p2, p3, p4].reduce((acc, p) => p.x > acc ? p.x : acc, 0);
        for (var i = 0; i < 2; i++) {
            var raySegment = [this.getPoint(i), {...this.getPoint(i), x: maxX + 1}];
            var nIntersections = bounds.reduce((acc, b) => this.segment_intersection(raySegment[0], raySegment[1], b[0], b[1]) ? acc + 1 : acc, 0)
            if (nIntersections % 2 == 1) {
                return true;
            }
        }

        // check intersection of bounding vectors
        for (var v = 0; v < bounds.length; v++) {
            const intersectsFuzzily = this.segment_intersection(bounds[v][0], bounds[v][1], this.p1, this.p2);

            if (intersectsFuzzily) return true;
        }

        return false;
    }

    isFuzzilyIntersectingCircle(p, r) {
        const h = get_distance(this.p1, p);
        const theta = this.get_corner_angle(p, this.p1, this.p2);
        const o = h * Math.sin(theta);

        return o <= r;
    }

    segment_intersection(p1, p2, p3, p4) {
        // check if two line segments intersect
        var ccw = this.counterclockwise;
        return ccw(p1, p3, p4) != ccw(p2, p3, p4) && ccw(p1, p2, p3) != ccw(p1, p2, p4);
    }

    counterclockwise(a, b, c) {
        // utility function for determining if line segments intersect
        return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
    }

    get_corner_angle(p1, p2, p3) {
        /*      p1
        /       /|
        /   b /  | a
        /   /A___|
        / p2   c  p3
        */

        var a = get_distance(p3, p1);
        var b = get_distance(p1, p2);
        var c = get_distance(p2, p3);

        return Math.acos(((b ** 2) + (c ** 2) - (a ** 2)) / (2 * b * c));
    }

}

module.exports = {
    'ConnorMouseQuadtreeTree': ConnorMouseQuadtreeTree,
    'Segment': Segment,
}
