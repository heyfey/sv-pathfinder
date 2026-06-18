#include <napi.h>
#include <uhdm/ElaboratorListener.h>
#include <uhdm/VpiListener.h>
#include <uhdm/uhdm.h>
#include <uhdm/vpi_user.h>

#include <algorithm>
#include <cctype>
#include <random>
#include <string>
// #include <map>
#include <mutex>
#include <unordered_map>
#include <vector>

// Utility function to log messages to the JavaScript console
void LogToConsole(const Napi::Env& env, const std::string& message) {
  Napi::Object global = env.Global();
  Napi::Value console = global.Get("console");
  if (console.IsObject()) {
    Napi::Object consoleObj = console.As<Napi::Object>();
    Napi::Value log = consoleObj.Get("log");
    if (log.IsFunction()) {
      Napi::Function logFn = log.As<Napi::Function>();
      logFn.Call(consoleObj, {Napi::String::New(env, message)});
    }
  }
}

std::string RepeatString(const std::string& str, int count) {
  return std::string(count, '  ') + str;
}

std::string getScopeTypeString(int scope_type) {
  switch (scope_type) {
    case vpiModule:
      return "Module";
    case vpiModuleArray:
      return "ModuleArray";
    case vpiInterface:
      return "Interface";
    case vpiProgram:
      return "Program";
    case vpiGenScope:
      return "Generate";
    case vpiGenScopeArray:
      return "Generate";
    case vpiTask:
      return "Task";
    case vpiFunction:
      return "Function";
    case vpiModport:
      return "Modport";
    case vpiClockingBlock:
      return "ClockingBlock";
    case vpiInterfaceArray:
      return "InterfaceArray";
    case vpiProgramArray:
      return "ProgramArray";
    default:
      return std::to_string(scope_type);
  }
}

// Wrapper class for vpiHandle
class VpiHandleWrap : public Napi::ObjectWrap<VpiHandleWrap> {
 public:
  // Factory method to create a new instance from a vpiHandle
  static Napi::Object New(Napi::Env env, vpiHandle handle) {
    Napi::Object obj = constructor.New({});  // Create JS object
    VpiHandleWrap* wrapper = Unwrap(obj);    // Get C++ instance
    wrapper->handle_ = handle;               // Set the handle
    return obj;
  }

  // Initialize the class (called once during addon setup)
  static void Init(Napi::Env env) {
    Napi::Function func = DefineClass(env, "VpiHandle", {});
    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();  // Keep constructor alive
  }

  // Constructor: Called by Napi when creating the JS object
  VpiHandleWrap(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<VpiHandleWrap>(info), handle_(nullptr) {}

  // Destructor: Release the handle when the JS object is garbage collected
  ~VpiHandleWrap() {
    if (handle_) {
      vpi_release_handle(handle_);
    }
  }

  // Public method to get the constructor
  static Napi::Function GetConstructor() { return constructor.Value(); }

  // Public method to get the handle
  vpiHandle GetHandle() const { return handle_; }

 private:
  vpiHandle handle_;  // The stored UHDM handle
  static Napi::FunctionReference
      constructor;  // Persistent constructor reference
};

// Define the static member
Napi::FunctionReference VpiHandleWrap::constructor;

// Data structures for moduleDef:Instances
typedef struct {
  std::string name;
  std::string type;
  std::string file;
  int line;
  int column;
} moduleDefContext;

typedef struct {
  std::string fullName;
  std::string name;
  std::string type;
  std::string file;
  int line;
  int column;
} instContext;

// module name: moduleDefContext
typedef std::map<std::string, moduleDefContext> ModuleDefContextMap;
// module name: [instContext]. instContext should be sorted by fullName
typedef std::unordered_map<std::string, std::vector<instContext>>
    InstContextMap;

typedef struct {
  std::string filename;
  std::unique_ptr<UHDM::Serializer> serializer;
  vpiHandle design;
  ModuleDefContextMap moduleDefContextMap;
  InstContextMap instContextMap;
} DesignContext;

std::unordered_map<int, DesignContext> designContextMap;
std::mutex designContextMapMutex;

// Walk the whole elaborated design once, indexing every module/interface/program INSTANCE by its
// definition name (-> instContextMap) and recording each definition (-> moduleDefContextMap).
//
// Generate scopes (vpiGenScope/vpiGenScopeArray) are recursed THROUGH but deliberately NOT indexed
// as their own entries. This matches slang-server's InstanceIndexer (which only handles
// InstanceSymbol): the index is keyed by definition name, and a generate block has no definition to
// key on — it surfaces only as a path segment (e.g. "gen_blk[0]") inside an instance's vpiFullName.
// So "find instance" matches modules/interfaces/programs, not gen-blocks — consistent with slang.
//
// Prefer EnsureDesignIndex() — a loaded design is immutable (a reload makes a fresh DesignContext),
// so this should run at most once. The clear() up front makes a direct rebuild idempotent: the
// traversal push_back()s into instContextMap, so re-running on a populated map would double every
// instance (and the def sizes derived from it).
void BuildDesignIndex(DesignContext& dc) {
  dc.moduleDefContextMap.clear();
  dc.instContextMap.clear();
  if (!dc.design) {
    return;
  }

  auto traverse = [&](auto& self, vpiHandle scopeHandle) -> void {
    int scope_type = vpi_get(vpiType, scopeHandle);

    if (scope_type == vpiModule || scope_type == vpiInterface ||
        scope_type == vpiProgram) {
      const char* def_name_c = vpi_get_str(vpiDefName, scopeHandle);
      if (def_name_c) {
        std::string def_name = def_name_c;

        instContext inst_ctx;
        inst_ctx.name = vpi_get_str(vpiName, scopeHandle)
                            ? vpi_get_str(vpiName, scopeHandle)
                            : "";
        inst_ctx.fullName = vpi_get_str(vpiFullName, scopeHandle)
                                ? vpi_get_str(vpiFullName, scopeHandle)
                                : inst_ctx.name;
        inst_ctx.type = getScopeTypeString(scope_type);
        inst_ctx.file = vpi_get_str(vpiFile, scopeHandle)
                            ? vpi_get_str(vpiFile, scopeHandle)
                            : "";
        inst_ctx.line = vpi_get(vpiLineNo, scopeHandle);
        inst_ctx.column = vpi_get(vpiColumnNo, scopeHandle);
        dc.instContextMap[def_name].push_back(inst_ctx);

        if (dc.moduleDefContextMap.find(def_name) ==
            dc.moduleDefContextMap.end()) {
          moduleDefContext def_ctx;
          def_ctx.name = def_name;
          def_ctx.type = getScopeTypeString(scope_type);
          def_ctx.file = vpi_get_str(vpiDefFile, scopeHandle)
                             ? vpi_get_str(vpiDefFile, scopeHandle)
                             : inst_ctx.file;
          def_ctx.line = vpi_get(vpiDefLineNo, scopeHandle)
                             ? vpi_get(vpiDefLineNo, scopeHandle)
                             : inst_ctx.line;
          def_ctx.column = 0;
          dc.moduleDefContextMap[def_name] = def_ctx;
        }
      }
    }

    std::vector<int> types = {
        vpiModule,    vpiModuleArray,    vpiGenScope, vpiGenScopeArray,
        vpiInterface, vpiInterfaceArray, vpiProgram,  vpiProgramArray,
        vpiTaskFunc,  vpiTask,           vpiFunction, vpiClockingBlock,
        vpiModport};
    for (int type : types) {
      vpiHandle iter = vpi_iterate(type, scopeHandle);
      if (iter) {
        while (vpiHandle sub_h = vpi_scan(iter)) {
          self(self, sub_h);
          vpi_release_handle(sub_h);
        }
        vpi_release_handle(iter);
      }
    }
  };

  vpiHandle iter = vpi_iterate(UHDM::uhdmtopModules, dc.design);
  if (iter) {
    while (vpiHandle top_h = vpi_scan(iter)) {
      traverse(traverse, top_h);
      vpi_release_handle(top_h);
    }
    vpi_release_handle(iter);
  }
}

// Build the instance index lazily if it hasn't been built yet (a real design has at least the top
// instance, so an empty map means "not indexed"). Lets the search work even when the Modules view
// (which calls getModuleDefs) was never opened.
void EnsureDesignIndex(DesignContext& dc) {
  if (dc.instContextMap.empty()) {
    BuildDesignIndex(dc);
  }
}

// Case-insensitive subsequence match, mirroring slang-server's fuzzyMatch (SlangServer.cpp): true
// when every character of `query` occurs in `candidate` in order. An empty query matches everything.
bool FuzzySubseqMatch(const std::string& query, const std::string& candidate) {
  size_t qi = 0;
  for (size_t ci = 0; qi < query.size() && ci < candidate.size(); ++ci) {
    if (std::tolower(static_cast<unsigned char>(query[qi])) ==
        std::tolower(static_cast<unsigned char>(candidate[ci]))) {
      ++qi;
    }
  }
  return qi == query.size();
}

// Worker for LoadDesign
class LoadDesignWorker : public Napi::AsyncWorker {
 public:
  LoadDesignWorker(Napi::Promise::Deferred deferred, std::string filename)
      : Napi::AsyncWorker(deferred.Env()),
        deferred(deferred),
        filename(filename) {}

  void Execute() override {
    serializer = std::make_unique<UHDM::Serializer>();
    restoredDesigns = serializer->Restore(filename);
    if (restoredDesigns.empty()) {
      SetError("Failed to restore design from " + filename);
      return;
    }

    design = restoredDesigns[0];  // Only consider the first design
    if (!vpi_get(vpiElaborated, design)) {
      elaboratorContext = new UHDM::ElaboratorContext(serializer.get());
      elaboratorContext->m_elaborator.listenDesigns(restoredDesigns);
      delete elaboratorContext;
    }

    static std::random_device rd;
    static std::mt19937 gen(rd());
    static std::uniform_int_distribution<> dis(1, 1000000);
    designId = dis(gen);

    {
      std::lock_guard<std::mutex> lock(designContextMapMutex);
      designContextMap[designId] =
          DesignContext{filename, std::move(serializer), design};
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    deferred.Resolve(Napi::Number::New(env, designId));
  }

 private:
  Napi::Promise::Deferred deferred;
  std::string filename;
  std::unique_ptr<UHDM::Serializer> serializer;
  std::vector<vpiHandle> restoredDesigns;
  vpiHandle design = nullptr;
  UHDM::ElaboratorContext* elaboratorContext = nullptr;
  int designId = -1;
};

// Function to load UHDM design (now async)
Napi::Value LoadDesign(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    deferred.Reject(
        Napi::TypeError::New(env, "String argument (filename) expected")
            .Value());
    return deferred.Promise();
  }

  std::string filename = info[0].As<Napi::String>().Utf8Value();
  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

  LoadDesignWorker* worker = new LoadDesignWorker(deferred, filename);
  worker->Queue();

  return deferred.Promise();
}

class GetModuleDefsWorker : public Napi::AsyncWorker {
 public:
  GetModuleDefsWorker(Napi::Promise::Deferred deferred, int designId)
      : Napi::AsyncWorker(deferred.Env()),
        deferred(deferred),
        designId(designId) {}

  void Execute() override {
    {
      std::lock_guard<std::mutex> lock(designContextMapMutex);
      auto it = designContextMap.find(designId);
      if (it == designContextMap.end()) {
        SetError("Design ID not found");
        return;
      }
      dc = &it->second; // Store pointer for use outside lock
    }
    design = dc->design;
    if (!design) {
      SetError("Design not loaded");
      return;
    }

    EnsureDesignIndex(*dc);  // build once; reuse if search (or a prior call) already indexed
  }

  void OnOK() override {
    Napi::Env env = Env();
    // Build the result array of module definitions
    Napi::Array result = Napi::Array::New(env);
    uint32_t index = 0;
    for (const auto& pair : dc->moduleDefContextMap) {
      const moduleDefContext& ctx = pair.second;
      Napi::Object obj = Napi::Object::New(env);
      obj.Set("defName", ctx.name);
      obj.Set("type", ctx.type);
      obj.Set("file", ctx.file);
      obj.Set("line", ctx.line);
      obj.Set("column", ctx.column);
      obj.Set("size", dc->instContextMap[ctx.name].size());
      result.Set(index++, obj);
    }
    deferred.Resolve(result);
  }

 private:
  Napi::Promise::Deferred deferred;
  int designId;
  DesignContext* dc = nullptr;
  vpiHandle design = nullptr;
};

// Wrap getModuleDefs (now async)
Napi::Value GetModuleDefs(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    deferred.Reject(
        Napi::TypeError::New(env, "Number argument (design ID) expected")
            .Value());
    return deferred.Promise();
  }

  int designId = info[0].As<Napi::Number>().Int32Value();
  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

  GetModuleDefsWorker* worker = new GetModuleDefsWorker(deferred, designId);
  worker->Queue();

  return deferred.Promise();
}

// Wrap getTopModules
Napi::Value GetTopModules(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // Check if there is at least one argument and it’s a number (design ID)
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Number argument (design ID) expected")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Get the design ID from the first argument
  int designId = info[0].As<Napi::Number>().Int32Value();
  vpiHandle design = nullptr;
  {
    std::lock_guard<std::mutex> lock(designContextMapMutex);
    // Check if the design ID exists in the designContextMap
    auto it = designContextMap.find(designId);
    if (it == designContextMap.end()) {
      Napi::Error::New(env, "Design ID not found").ThrowAsJavaScriptException();
      return env.Null();
    }
    // Get the design handle from the DesignContext
    design = it->second.design;
    if (!design) {
      Napi::Error::New(env, "Design not loaded").ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  vpiHandle iter = vpi_iterate(UHDM::uhdmtopModules, design);
  Napi::Array result = Napi::Array::New(env);
  uint32_t index = 0;

  while (vpiHandle obj_h = vpi_scan(iter)) {
    Napi::Object module = Napi::Object::New(env);
    if (const char* s = vpi_get_str(vpiDefName, obj_h))
      module.Set("defName", s);
    if (const char* s = vpi_get_str(vpiName, obj_h)) module.Set("name", s);
    if (const char* s = vpi_get_str(vpiFile, obj_h)) module.Set("file", s);
    module.Set("line", vpi_get(vpiLineNo, obj_h));
    module.Set("column", vpi_get(vpiColumnNo, obj_h));
    module.Set("handle", VpiHandleWrap::New(env, obj_h));
    result[index++] = module;

    // Do not release here as VpiHandleWrap will manage it
    // vpi_release_handle(obj_h);
  }
  vpi_release_handle(iter);
  return result;
}

void CollectSubScopes(const Napi::CallbackInfo& info,
                      const vpiHandle& scopeHandle, Napi::Array& result,
                      int level, bool isFromGenScopeArray = false) {
  Napi::Env env = info.Env();
  std::vector<int> types = {vpiModule,         /*vpiModuleArray,*/ vpiGenScope,
                            vpiGenScopeArray,  vpiInterface,
                            vpiProgram,        vpiTaskFunc,
                            vpiTask,           vpiFunction,
                            vpiClockingBlock,  vpiModport,
                            vpiInterfaceArray, vpiProgramArray};

  // LogToConsole(env, RepeatString("  ", level) + "CollectSubScopes level=" +
  //                       std::to_string(level) + ", parent_type=" +
  //                       std::to_string(vpi_get(vpiType, scopeHandle)) +
  //                       ", isFromGenScopeArray=" +
  //                       std::string(isFromGenScopeArray ? "true" : "false"));

  for (int type : types) {
    vpiHandle iter = vpi_iterate(type, scopeHandle);
    if (iter) {
      while (vpiHandle obj_h = vpi_scan(iter)) {
        std::string obj_name =
            vpi_get_str(vpiFullName, obj_h)
                ? vpi_get_str(vpiFullName, obj_h)
                : (vpi_get_str(vpiName, obj_h) ? vpi_get_str(vpiName, obj_h)
                                               : "unnamed");
        // LogToConsole(env, RepeatString("  ", level) + "Found obj: type=" +
        //                       std::to_string(vpi_get(vpiType, obj_h)) +
        //                       ", name=" + obj_name);

        // For GenScopeArray, get all it's subscopes recursively for one
        // level instead. TODO: how about nested GenScopeArray?
        if (type == vpiGenScopeArray) {
          // LogToConsole(env, RepeatString("  ", level) +
          //                       "Expanding GenScopeArray: " + obj_name);
          if (isFromGenScopeArray) {
            // If we are already in a GenScopeArray, skip this one
            continue;
          }
          CollectSubScopes(info, obj_h, result, level + 1,
                           true /*isFromGenScopeArray*/);
          continue;
        }

        Napi::Object scope = Napi::Object::New(env);
        if (const char* s = vpi_get_str(vpiDefName, obj_h))
          scope.Set("defName", s);
        else
          scope.Set("defName", "");

        if (const char* s = vpi_get_str(vpiFullName, obj_h))
          scope.Set("name", s);
        else {  // If FullName is not available, use Name e.g. modport
          scope.Set("name", vpi_get_str(vpiName, obj_h)
                                ? vpi_get_str(vpiName, obj_h)
                                : "unnamed");
        }

        if (const char* s = vpi_get_str(vpiFile, obj_h))
          scope.Set("file", s);
        else
          scope.Set("file", "");

        scope.Set("line", vpi_get(vpiLineNo, obj_h));
        scope.Set("column", vpi_get(vpiColumnNo, obj_h));
        scope.Set("type", getScopeTypeString(vpi_get(vpiType, obj_h)));
        scope.Set("handle", VpiHandleWrap::New(env, obj_h));
        uint32_t index = result.Length();
        result[index++] = scope;

        // Do not release here as VpiHandleWrap will manage it
        // vpi_release_handle(obj_h);
      }
      vpi_release_handle(iter);  // Release the iterator handle
    }
  }
}

Napi::Value GetSubScopes(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // Check if there is at least one argument, it’s an object, and it’s an
  // instance of VpiHandleWrap
  if (info.Length() < 1 || !info[0].IsObject() ||
      !info[0].As<Napi::Object>().InstanceOf(VpiHandleWrap::GetConstructor())) {
    Napi::TypeError::New(env, "VpiHandleWrap argument expected")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Unwrap the VpiHandleWrap object to get the C++ instance
  VpiHandleWrap* wrap = VpiHandleWrap::Unwrap(info[0].As<Napi::Object>());
  vpiHandle scopeHandle = wrap->GetHandle();

  // If the handle is null, return an empty array
  if (!scopeHandle) {
    return Napi::Array::New(env, 0);
  }

  Napi::Array result = Napi::Array::New(env);
  CollectSubScopes(info, scopeHandle, result, 0);

  return result;
}

Napi::Value GetVars(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // Validate input: Expecting a single VpiHandleWrap argument
  if (info.Length() < 1 || !info[0].IsObject() ||
      !info[0].As<Napi::Object>().InstanceOf(VpiHandleWrap::GetConstructor())) {
    Napi::TypeError::New(env, "VpiHandleWrap argument expected")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Unwrap the VpiHandleWrap to access the vpiHandle
  VpiHandleWrap* wrap = VpiHandleWrap::Unwrap(info[0].As<Napi::Object>());
  vpiHandle scopeHandle = wrap->GetHandle();

  // Create an array to hold variable information
  Napi::Array result = Napi::Array::New(env);
  uint32_t index = 0;

  // Helper lambda to collect variables of a specific type
  auto collectVars = [&](int type, const std::string& typeName) {
    vpiHandle iter = vpi_iterate(type, scopeHandle);
    if (iter) {
      while (vpiHandle obj_h = vpi_scan(iter)) {
        Napi::Object var = Napi::Object::New(env);
        var.Set("type", typeName);
        if (const char* name = vpi_get_str(vpiFullName, obj_h)) {
          var.Set("name", name);
        } else {  // If FullName is not available, use Name e.g. vars in modport
          var.Set("name", vpi_get_str(vpiName, obj_h)
                              ? vpi_get_str(vpiName, obj_h)
                              : "unnamed");
        }
        if (const char* file = vpi_get_str(vpiFile, obj_h)) {
          var.Set("file", file);
        }
        var.Set("line", vpi_get(vpiLineNo, obj_h));
        var.Set("column", vpi_get(vpiColumnNo, obj_h));
        var.Set("width", vpi_get(vpiSize, obj_h));  // Not working now

        // Get constant value for parameters
        if (type == vpiParameter) {
          s_vpi_value val;
          vpi_get_value(obj_h, &val);
          switch (val.format) {
            case vpiIntVal:
            case vpiUIntVal:
            case vpiShortIntVal:
            case vpiLongIntVal:
              var.Set("constValue", static_cast<int>(val.value.integer));
              break;
            case vpiRealVal:
            case vpiShortRealVal:
              var.Set("constValue", static_cast<float>(val.value.real));
              break;
            case vpiStringVal:
            case vpiBinStrVal:
            case vpiOctStrVal:
            case vpiDecStrVal:
            case vpiHexStrVal:
              var.Set("constValue", std::string(val.value.str));
              break;
            case vpiScalarVal:
            case vpiVectorVal:
            case vpiStrengthVal:
            case vpiTimeVal:
            case vpiObjTypeVal:
            case vpiSuppressVal:
            case vpiRawTwoStateVal:
            case vpiRawFourStateVal:
              // Not handled currently
              break;
            default:
              break;
          }
        }

        result.Set(index++, var);
        vpi_release_handle(obj_h);  // Clean up object handle
      }
      vpi_release_handle(iter);  // Clean up iterator handle
    }
  };

  // Collect variables of each type
  collectVars(vpiNet, "net");
  collectVars(vpiArrayNet, "net");
  collectVars(vpiReg, "reg");
  collectVars(vpiVariables, "variable");
  collectVars(vpiIntegerVar, "integer");
  collectVars(vpiRealVar, "real");
  collectVars(vpiShortRealVar, "real");
  collectVars(vpiParameter, "parameter");
  // For vpiModPort
  collectVars(vpiIODecl, "net");
  // For vpiClockingBlock
  collectVars(vpiClockingEvent, "net");
  collectVars(vpiClockingIODecl, "net");

  return result;
}

Napi::Value GetModuleDef(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // Validate input: Expecting a single VpiHandleWrap argument
  if (info.Length() < 1 || !info[0].IsObject() ||
      !info[0].As<Napi::Object>().InstanceOf(VpiHandleWrap::GetConstructor())) {
    Napi::TypeError::New(env, "VpiHandleWrap argument expected")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Unwrap the VpiHandleWrap to access the vpiHandle
  VpiHandleWrap* wrap = VpiHandleWrap::Unwrap(info[0].As<Napi::Object>());
  vpiHandle instHandle = wrap->GetHandle();

  Napi::Object result = Napi::Object::New(env);
  if (const char* s = vpi_get_str(vpiDefName, instHandle))
    result.Set("defName", s);
  if (const char* s = vpi_get_str(vpiDefFile, instHandle))
    result.Set("file", s);
  result.Set("line", vpi_get(vpiDefLineNo, instHandle));
  result.Set("column", 0);  // No vpiDefColumnNo available

  return result;
}

// Wrap getModuleInstances
Napi::Value GetModuleInstances(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
    Napi::TypeError::New(
        env, "Expected arguments: Number (design ID), String (moduleDef name)")
        .ThrowAsJavaScriptException();
    return Napi::Array::New(env);
  }

  int designId = info[0].As<Napi::Number>().Int32Value();
  std::string moduleDefName = info[1].As<Napi::String>().Utf8Value();

  std::vector<instContext> instances;
  {
    std::lock_guard<std::mutex> lock(designContextMapMutex);
    auto it = designContextMap.find(designId);
    if (it == designContextMap.end()) {
      Napi::Error::New(env, "Design ID not found").ThrowAsJavaScriptException();
      return Napi::Array::New(env);
    }

    DesignContext& dc = it->second;

    auto instIt = dc.instContextMap.find(moduleDefName);
    if (instIt == dc.instContextMap.end()) {
      return Napi::Array::New(env);
    }
    instances = instIt->second;  // Copy to local vector
  }

  // Sort by fullName
  std::sort(instances.begin(), instances.end(),
            [](const instContext& a, const instContext& b) {
              return a.fullName < b.fullName;
            });

  Napi::Array result = Napi::Array::New(env);
  uint32_t index = 0;
  for (const auto& inst : instances) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("fullName", inst.fullName);
    obj.Set("name", inst.name);
    obj.Set("type", inst.type);
    obj.Set("file", inst.file);
    obj.Set("line", inst.line);
    obj.Set("column", inst.column);
    result.Set(index++, obj);
  }

  return result;
}

// Async "find instance" search over the resident instance index (built once via EnsureDesignIndex).
// Subsequence-matches `query` against each instance's full hierarchy path, returns up to maxResults
// (sorted by path) plus the total match count so the UI can show "showing N of M". Match + cap run
// on the worker thread, and only maxResults instances are marshalled back — the full list never
// crosses into JS. Generate scopes are not candidates (see BuildDesignIndex).
class SearchInstancesWorker : public Napi::AsyncWorker {
 public:
  SearchInstancesWorker(Napi::Promise::Deferred deferred, int designId,
                        std::string query, int maxResults)
      : Napi::AsyncWorker(deferred.Env()),
        deferred(deferred),
        designId(designId),
        query(std::move(query)),
        maxResults(maxResults) {}

  void Execute() override {
    std::lock_guard<std::mutex> lock(designContextMapMutex);
    auto it = designContextMap.find(designId);
    if (it == designContextMap.end()) {
      SetError("Design ID not found");
      return;
    }
    DesignContext& dc = it->second;
    EnsureDesignIndex(dc);  // build the instance index once if needed (skips gen scopes)

    for (const auto& pair : dc.instContextMap) {
      for (const auto& inst : pair.second) {
        if (!FuzzySubseqMatch(query, inst.fullName)) {
          continue;
        }
        ++total;
        if (maxResults <= 0 || static_cast<int>(results.size()) < maxResults) {
          results.push_back({inst, pair.first});
        }
      }
    }
    std::sort(results.begin(), results.end(),
              [](const Match& a, const Match& b) {
                return a.inst.fullName < b.inst.fullName;
              });
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Array arr = Napi::Array::New(env);
    uint32_t index = 0;
    for (const auto& m : results) {
      Napi::Object obj = Napi::Object::New(env);
      obj.Set("fullName", m.inst.fullName);
      obj.Set("declName", m.declName);
      obj.Set("type", m.inst.type);
      obj.Set("file", m.inst.file);
      obj.Set("line", m.inst.line);
      obj.Set("column", m.inst.column);
      arr.Set(index++, obj);
    }
    Napi::Object out = Napi::Object::New(env);
    out.Set("total", total);
    out.Set("results", arr);
    deferred.Resolve(out);
  }

 private:
  struct Match {
    instContext inst;
    std::string declName;
  };
  Napi::Promise::Deferred deferred;
  int designId;
  std::string query;
  int maxResults;
  size_t total = 0;
  std::vector<Match> results;
};

// searchInstances(designId, query, maxResults) -> Promise<{ total, results: [...] }>
Napi::Value SearchInstances(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsString() ||
      !info[2].IsNumber()) {
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    deferred.Reject(
        Napi::TypeError::New(
            env, "Expected: Number (design ID), String (query), Number (max)")
            .Value());
    return deferred.Promise();
  }
  int designId = info[0].As<Napi::Number>().Int32Value();
  std::string query = info[1].As<Napi::String>().Utf8Value();
  int maxResults = info[2].As<Napi::Number>().Int32Value();
  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
  (new SearchInstancesWorker(deferred, designId, query, maxResults))->Queue();
  return deferred.Promise();
}

Napi::Value UnloadDesign(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // Validate input: Expecting a single number argument (design ID)
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Number argument (design ID) expected")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Get the design ID from the argument
  int designId = info[0].As<Napi::Number>().Int32Value();

  std::lock_guard<std::mutex> lock(designContextMapMutex);
  // Find the design context in the map
  auto it = designContextMap.find(designId);
  if (it == designContextMap.end()) {
    Napi::Error::New(env, "Design ID not found").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Release the design handle if it exists
  if (it->second.design) {
    vpi_release_handle(it->second.design);
    it->second.design = nullptr;  // Set to null after releasing
  }

  // Remove the design context from the map
  designContextMap.erase(it);

  // Return undefined to indicate successful completion
  return env.Undefined();
}

// Initialize the addon
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  VpiHandleWrap::Init(env);  // Set up the VpiHandleWrap class
  exports.Set("loadDesign", Napi::Function::New(env, LoadDesign));
  exports.Set("unloadDesign", Napi::Function::New(env, UnloadDesign));
  exports.Set("getTopModules", Napi::Function::New(env, GetTopModules));
  exports.Set("getSubScopes", Napi::Function::New(env, GetSubScopes));
  exports.Set("getVars", Napi::Function::New(env, GetVars));
  exports.Set("getModuleDef", Napi::Function::New(env, GetModuleDef));
  exports.Set("getModuleDefs", Napi::Function::New(env, GetModuleDefs));
  exports.Set("getModuleInstances",
              Napi::Function::New(env, GetModuleInstances));
  exports.Set("searchInstances", Napi::Function::New(env, SearchInstances));
  return exports;
}

NODE_API_MODULE(uhdm_addon, Init)