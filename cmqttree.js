const max_leaves = 5;
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
        if (!segment.isContainedWithin(this.x, this.y, this.width, this.height)) {
            return false;
        }
        if (this.is_branch()) {
            // check children
            for (var i = 0; i < this.children.length; i++) {
                // attempt inset into those points
                const ok = this.children[i].insert(segment);
                if (ok) return true;
            }
        } else {
            // attempt insert or subdivide
            if (this.children.length >= this.max_leaves) {
                this.subdivide(segment);
            }
            else {
                this.children.push(segment);
            }
        }

        return false;
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
                    if (ok)
                        this.children.splice(c, 1);
                }
            }
            
            // add the new ConnorMouseQuadtreeTree to the array if segments were successfully inserted
            if (cmqtt.children.length > 0) {
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

                // get the perpendicular  
                var dx = radius * cos(segment.theta + HALF_PI);
                var dy = radius * sin(segment.theta + HALF_PI); 

                // check if segment is within rectangular box around reference segment
                var isContained = child.isContainedWithin(segment.p1.x - dx, segment.p1.y - dy, 2 * radius, segment.length) ||
                                  child.isContainedWithin(segment.p1.x, segment.p1.y, radius) ||
                                  child.isContainedWithin(segment.p2.x, segment.p2.y, radius);

                if (isContained)
                    segments.push(child);
            }

            return segments;
        }

        // if we are here, the children are quadtrees and we will query them
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
        this.theta = atan2(p1.y - p2.y, p1.x - p2.x);
        this.length = this.get_distance(p1, p2);
    }

    isContainedWithin(x, y, widthOrRadius, h) {
        if (h === undefined)
            return this.isContainedWithinCircle(x, y, widthOrRadius);

        return this.isContainedWithinRect(x, y, widthOrRadius, h);
    }

    isContainedWithinRect(x, y, w, h) {
        // check if either points are within this plane
        if ((this.p1.x >= x && this.p1.x < x + w && this.p1.y >= y && this.p1.y < y + h) ||
            (this.p2.x >= x && this.p2.x < x + w && this.p2.y >= y && this.p2.y < y + h))
            return true;
            
        // construct bounding vectors of plane
        const bounds = [
            [{x, y}, {x: x+w, y}],
            [{x: x+w, y}, {x: x+w, y: y+h}],
            [{x: x+w, y: y+h}, {x, y: y+h}],
            [{x, y: y+h}, {x, y}],
        ];

        // check intersection of bounding vectors
        for (var v = 0; v < bounds.length; v++) {
            const isIntersecting = this.segment_intersection(bounds[v], bounds[v+1], this.p1, this.p2);

            if (isIntersecting) return true;
        }

        return false;
    }

    isContainedWithinCircle(x, y, r) {
        const h = this.get_distance(this.p1, {x, y});
        const theta = this.get_corner_angle({x, y}, this.p1, this.p2);
        const o = h * sin(theta);

        return o <= r;
    }

    segment_intersection(p1, p2, p3, p4) {
        // check if two line segments intersect
        var ccw = this.counterclockwise;
        return ccw(p1, p3, p4) != ccw(p2, p3, p4) && ccw(p1, p2, p3) != ccw(p1, p2, p4);
    }

    counterclockwise(a, b, c) {
        // utility function for determining if line segments intersect
        return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
    }

    get_distance(p1, p2) {
        return Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));
    }

    get_corner_angle(p1, p2, p3) {
        /*      p1
        /       /|
        /   b /  | a
        /   /A___|
        / p2   c  p3
        */

        var a = this.get_distance(p3, p1);
        var b = this.get_distance(p1, p2);
        var c = this.get_distance(p2, p3);

        return Math.acos(((b ** 2) + (c ** 2) - (a ** 2)) / (2 * b * c));
    }

}
