// Interface with modports, clocking block, assertion, and coverage
interface counter_if (input logic clk);
  logic rst, load;
  logic [3:0] data, count;

  clocking cb @(posedge clk);
    default input #1ns output #1ns;
    output rst, load, data;
    input count;
  endclocking

  // Concurrent assertion
  assert property (@(posedge clk) disable iff (rst) (!load |-> $stable(count)))
    else $error("Assertion failed: count not stable when not loading");

  // Functional coverage
  covergroup cg;
    coverpoint count { bins low[4] = {[0:3]}; bins high[4] = {[12:15]}; }
    coverpoint load;
    cross count, load;
    option.per_instance = 1;
  endgroup
  cg cov_inst = new();  // Coverage instance

  modport dut (input clk, rst, load, data, output count);
  modport wrapper (input clk, rst, load, data, output count);  // Additional modport for hierarchy
  modport tb (input clk, count, output rst, load, data, clocking cb);

endinterface

// Transaction class
class Trans;
  rand bit load;
  rand bit [3:0] data;
  bit [3:0] expected;
  typedef enum logic [1:0] {IDLE, LOAD, INC, RESET} state_t;  // Enum for states
  state_t state;
  bit [3:0] history[5];

  constraint data_c { data inside {[0:10]}; }

  virtual function void calculate_expected(bit [3:0] prev_count);
    if (load)
      expected = data;
    else
      expected = prev_count + 1;
  endfunction

  function void post_randomize();
    state = load ? LOAD : INC;
    for (int j = 0; j < 5; j++) history[j] = data + j;
  endfunction

  function void print(string prefix = "");
    $display("%s: load=%b, data=%0d, expected=%0d, state=%s", prefix, load, data, expected, state);
    foreach (history[k]) $display("History[%0d] = %0d", k, history[k]);
  endfunction
endclass

// Driver class
class Driver;
  virtual counter_if vif;
  mailbox #(Trans) mbx;
  semaphore sem = new(1);

  task run();
    Trans t;
    $display("Driver starting...");
    forever begin
      sem.get(1);
      mbx.get(t);
      t.print("Driver");
      @(vif.cb);
      vif.cb.load <= t.load;
      vif.cb.data <= t.data;
      sem.put(1);
    end
  endtask
endclass

// Monitor class
class Monitor;
  virtual counter_if vif;
  mailbox #(bit [3:0]) mbx;

  task run();
    $display("Monitor starting...");
    forever begin
      @(vif.cb);
      mbx.put(vif.cb.count);
      $display("Monitor observed count = %0d", vif.cb.count);
    end
  endtask
endclass

// Scoreboard class
class Scoreboard;
  mailbox #(bit [3:0]) mbx;
  bit [3:0] expected_count = 0;

  task run();
    bit [3:0] observed;
    forever begin
      mbx.get(observed);
      if (observed != expected_count)
        $error("Scoreboard mismatch: expected %0d, got %0d", expected_count, observed);
      else
        $display("Scoreboard match: %0d", observed);
      expected_count = expected_count + 1;
    end
  endtask
endclass

// Environment class
class Env;
  Driver drv;
  Monitor mon;
  Scoreboard sb;
  mailbox #(Trans) drv_mbx = new();
  mailbox #(bit [3:0]) mon_mbx = new();
  virtual counter_if vif;

  function new(virtual counter_if v);
    vif = v;
    drv = new();
    drv.vif = vif;
    drv.mbx = drv_mbx;
    mon = new();
    mon.vif = vif;
    mon.mbx = mon_mbx;
    sb = new();
    sb.mbx = mon_mbx;
  endfunction

  task run();
    fork
      drv.run();
      mon.run();
      sb.run();
    join_none
  endtask
endclass

// Test program block
program test;
  Env env = new(top.cif);

  initial begin
    Trans t;
    bit [3:0] queue[$];   // Queue
    string assoc_array[bit [3:0]];  // Associative array
    int dynamic_array[];  // Dynamic array

    // Reset
    top.cif.rst = 1;
    @(posedge top.cif.clk);
    top.cif.rst = 0;

    // Start environment
    env.run();

    // Transactions
    for (int i = 0; i < 10; i++) begin
      t = new();
      assert(t.randomize()) else $fatal("Randomization failed");
      t.calculate_expected(i[3:0]);
      env.drv_mbx.put(t);
      @(posedge top.cif.clk);
      top.cif.cov_inst.sample();  // Sample coverage in testbench
    end

    // Additional features demo
    queue.push_back(1);
    queue.push_front(0);
    queue.pop_back();
    $display("Queue size: %0d", queue.size());

    assoc_array[4'hA] = "KeyA";
    if (assoc_array.exists(4'hA)) $display("Assoc value: %s", assoc_array[4'hA]);

    dynamic_array = new[5];
    foreach (dynamic_array[i]) dynamic_array[i] = i * 2;

    // Finish
    #100;
    $display("Coverage: %0.2f%%", top.cif.cov_inst.get_coverage());
    $finish;
  end
endprogram
