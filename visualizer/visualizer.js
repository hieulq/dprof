/*eslint-env browser */

(function (dump, d3) {
  // Get elements
  var info = d3.select('#info');
  var ticks = d3.select('#ticks');
  var content = d3.select('#content');

  // Settings
  var timeScale = 1e9; // seconds
  var timeUnit = 'sec';
  var timelineHeight = 20;

  //
  // Flatten datastructure
  //
  function Flatten(data) {
    this.nodes = [];
    this.total = data.total / timeScale;
    this.version = data.version;
    this.insert(null, data.root);
  }

  function Node(parent, node, index) {
    // Meta
    this.index = index; // related to top position
    this.id = index; // d3 id, doesn't change
    this.parent = parent;

    // Info
    this.name = node.name;
    this.stack = node.stack;

    // Position
    this.init = node.init / timeScale;
    this.before = node.before / timeScale;
    this.after = node.after / timeScale;
    this.top = this.index * timelineHeight + timelineHeight / 2;
  }

  Flatten.prototype.insert = function (parent, node) {
    var struct = new Node(parent, node, this.nodes.length);
    this.nodes.push(struct);
    node.children.forEach(this.insert.bind(this, struct));
  };

  Flatten.prototype.totalHeight = function () {
    return this.nodes[this.nodes.length - 1].top + timelineHeight / 2;
  };

  var flatten = new Flatten(dump);

  //
  // Set stats
  //
    info.select('#stats')
      .text(`dprof version: ${flatten.version}\ntime: ${flatten.total} ${timeUnit}`);

  //
  // Setup scale
  //
  var xScale = d3.scale.linear()
    .range([10, window.innerWidth - 10])
    .domain([0, flatten.total]);

  var xFormat = xScale.tickFormat();
  var xAxis = d3.svg.axis()
      .scale(xScale)
      .orient('top')
      .tickFormat(function (d) { return (d ? xFormat(d) : '0'); });

  ticks.append('g')
    .attr('class', 'x axis')
    .attr('transform', 'translate(0, 24)')
    .call(xAxis);

  function updateTicks() {
    xScale.range([10, window.innerWidth - 10]);
    ticks.select('.x.axis').call(xAxis);
  }

  //
  // Draw timeline
  //
  function drawTimelines() {
    // Update content height
    content.style('height', flatten.totalHeight());

    // Insert data dump
    var bar = content
      .selectAll('g')
        .data(flatten.nodes, function (d) { return d.id; });
    var barEnter = bar
      .enter().append('g')
        .attr('class', 'timeline');

    barEnter.append('path')
      .attr('class', function (d, i) {
        return 'background ' + (i % 2 ? 'even' : 'odd');
      });
    bar.select('.background')
      .attr('d', function (d) {
        return `M${xScale(0)} ${d.top}` + // Move to
               `H${xScale(flatten.total)}`; // Horizontal line to
      });

    barEnter.filter(function(d) { return d.parent; }).append('path')
      .attr('class', 'init');
    bar.select('.init')
      .attr('d', function (d) {
        // Add half after to top1. Add haft befor before top2
        return `M${xScale(d.init) - 1} ${d.parent.top + 6}` + // Move to
               `V${d.top + 3}`; // Vertical line to
      });

    barEnter.append('path')
      .attr('class', 'before');
    bar.select('.before')
      .attr('d', function (d) {
        return `M${xScale(d.init)} ${d.top}` + // Move to
               `H${xScale(d.before)}`; // Horizontal line to
      });

    barEnter.append('path')
      .attr('class', 'after');
    bar.select('.after')
      .attr('d', function (d) {
        return `M${xScale(d.before)} ${d.top}` + // Move to
               `H${xScale(d.after)}`; // Horizontal line to
      });
  }
  drawTimelines();

  //
  // Show info for timeline
  //
  content.on('click', function () {
    // Calculate the index of the row there was clicked on
    var rowIndex = Math.floor((
      d3.event.y + content.node().parentNode.scrollTop -
      content.node().getBoundingClientRect().top
    ) / timelineHeight);

    content.selectAll('g .background')
      .classed('selected', false);

    var row = content.selectAll(`g:nth-child(${rowIndex + 1})`);
    var node = row.datum();

    // Show only the last 6 callsites
    var stacktrace = node.stack.slice(-6).map(function (site) {
      return ' at ' + site.filename + ':' + site.line + ':' + site.column;
    }).join('\n');

    info.select('#stacktrace')
      .text('HANDLE NAME: ' + node.name + '\n' +
            'STACKTRACE:\n' + stacktrace);

    row.select('.background')
      .classed('selected', true);
  });

  //
  // handle resize
  //
  window.addEventListener('resize', function () {
    updateTicks();
    drawTimelines();
  });

})(window.datadump, window.d3);