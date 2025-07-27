// Function for use in expressions or defaults
function [3:0] offset_data;
  input [3:0] in;
  begin
    offset_data = in + 1;  // Simple offset
  end
endfunction

function [3:0] double_offset;
  input [3:0] in;
  begin
    double_offset = offset_data(in) + 1;  // Chained function call
  end
endfunction

// Basic Verilog-style module (core DUT)
module counter (
  input wire clk,
  input wire rst,
  input wire load,
  input wire [3:0] data,
  output reg [3:0] count
);

  // Always block
  always @(posedge clk) begin
    if (rst)
      count <= 4'b0;  // Reset
    else if (load)
      count <= data;  // Load
    else
      count <= count + 1;  // Increment
  end

  // Immediate assertion (using $warning for compatibility, though not standard Verilog; simulators often support)
  always @( * ) if (!(count <= 4'hF)) $warning("Count overflow");

endmodule

// Additional layer: Counter cell with `celldefine` for cell definition
`celldefine
module counter_cell (
  input wire clk,
  input wire rst,
  input wire load,
  input wire [3:0] data,
  output wire [3:0] count
);

  // Instantiate with all named connections, including function call
  counter dut (
    .clk(clk),
    .rst(rst),
    .load(load),
    .data(double_offset(data)),  // Function call in port connection
    .count(count)
  );

endmodule
`endcelldefine

// Additional layer: Wrapper module around counter_cell
module counter_wrapper (
  input wire clk,
  input wire rst,
  input wire load,
  input wire [3:0] data,
  output wire [3:0] count
);

  // Instantiate counter_cell with named connections
  counter_cell ccell (
    .clk(clk),
    .rst(rst),
    .load(load),
    .data(data),
    .count(count)
  );

endmodule

// Middle layer: Multi-counter with generate for loop
module multi_counter #(
  parameter NUM_COUNTERS = 2
) (
  input wire clk,
  input wire rst,
  input wire load,
  input wire [3:0] data,
  output wire [3:0] count
);

  // Internal buses
  wire [NUM_COUNTERS-1:0] internal_load;
  wire [3:0] internal_data [NUM_COUNTERS-1:0];
  wire [3:0] internal_count [NUM_COUNTERS-1:0];

  assign internal_load = { { (NUM_COUNTERS-1) {1'b0} } , load };  // Fan out for demo

  generate
    for (genvar k = 0; k < NUM_COUNTERS; k = k + 1) begin : gen_assigns
      assign internal_data[k] = (k == 0) ? data : '0;
    end
  endgenerate

  assign count = internal_count[0];

  // Generate with for loop for instantiating modules
  generate
    for (genvar i = 0; i < NUM_COUNTERS; i = i + 1) begin : gen_wrappers
      counter_wrapper wrp (
        .clk(clk),
        .rst(rst),
        .load(internal_load[i]),
        .data(offset_data(internal_data[i])),  // Function call
        .count(internal_count[i])
      );
    end
  endgenerate

endmodule

// Top DUT layer: Super multi-counter with generate for loop instead of module array
module super_multi_counter #(
  parameter NUM_SUPER = 2
) (
  input wire clk,
  input wire rst,
  input wire load,
  input wire [3:0] data,
  output wire [3:0] count
);

  // Internal buses
  wire [3:0] internal_count [NUM_SUPER-1:0];

  // Generate for loop instantiation for multiple multi_counters
  generate
    for (genvar i = 0; i < NUM_SUPER; i = i + 1) begin : gen_mc
      multi_counter #(.NUM_COUNTERS(1)) mc_inst (
        .clk(clk),
        .rst(rst),
        .load(load),
        .data(data),
        .count(internal_count[i])
      );
    end
  endgenerate

  // Connect only the first instance's count to avoid multiple drivers
  assign count = internal_count[0];

  // Additional generate demo: generate if
  generate
    if (NUM_SUPER > 1) begin : gen_extra
      // Could instantiate more, but for demo a dummy wire
      wire dummy = load || internal_count[1][0];  // Connect to internal count
    end
  endgenerate

  // Generate case for variety
  generate
    case (NUM_SUPER)
      2: begin : gen_case
        // For loop inside case
        for (genvar j = 0; j < NUM_SUPER; j = j + 1) begin : loop_in_case
          // Dummy always (no assertion in pure Verilog; use display for demo)
          always @(*) if (!(internal_count[j] >= 0)) $display("Dummy check failed");
        end
      end
      default: ;  // Empty
    endcase
  endgenerate

endmodule

// Top module
module top;
  logic clk = 0;
  always #5 clk = ~clk;

  counter_if cif(clk);

  // Instantiate super_multi_counter with discrete ports
  super_multi_counter #(.NUM_SUPER(2)) smc_inst (
    .clk(cif.clk),
    .rst(cif.rst),
    .load(cif.load),
    .data(cif.data),
    .count(cif.count)
  );

endmodule