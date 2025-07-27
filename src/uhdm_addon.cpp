#include <napi.h>
#include <uhdm/ElaboratorListener.h>
#include <uhdm/VpiListener.h>
#include <uhdm/uhdm.h>
#include <uhdm/vpi_user.h>

#include <random>
#include <string>
// #include <map>
#include <unordered_map>
#include <vector>

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
// typedef struct {
//   std::string fullName;
//   std::string name;
//   std::string file;
//   int line;
//   int column;
// } instContext;

// typedef struct {
//   std::string name;
//   std::string file;
//   int line;
//   int column;
// } moduleDefContext;

// typedef std::map<std::string, moduleDefContext> ModuleDefContextMap;
// typedef std::unordered_map<std::string, std::vector<instContext>>
//     ModuleDefInstContextMap;  // All instances in each module definition

typedef struct {
  std::string filename;
  std::unique_ptr<UHDM::Serializer> serializer;
  vpiHandle design;
  // ModuleDefContextMap moduleDefContextMap;
  // ModuleDefInstContextMap moduleDefInstContextMap;
} DesignContext;

std::unordered_map<int, DesignContext> designContextMap;

// Function to load UHDM design
Napi::Number LoadDesign(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "String argument (filename) expected")
        .ThrowAsJavaScriptException();
    return Napi::Number::New(env, -1);
  }

  std::string filename = info[0].As<Napi::String>().Utf8Value();
  auto serializer = std::make_unique<UHDM::Serializer>();
  const std::vector<vpiHandle>& restoredDesigns = serializer->Restore(filename);
  if (restoredDesigns.empty()) {
    Napi::Error::New(env, "Failed to restore design from " + filename)
        .ThrowAsJavaScriptException();
    return Napi::Number::New(env, -1);
  }

  vpiHandle design = restoredDesigns[0];  // Only consider the first design
  if (!vpi_get(vpiElaborated, design)) {
    UHDM::ElaboratorContext* elaboratorContext =
        new UHDM::ElaboratorContext(serializer.get());
    elaboratorContext->m_elaborator.listenDesigns(restoredDesigns);
    delete elaboratorContext;
  }

  // Generate random id for design context
  static std::random_device rd;
  static std::mt19937 gen(rd());
  static std::uniform_int_distribution<> dis(1, 1000000);
  int designId = dis(gen);
  // Create a new DesignContext and store it
  designContextMap[designId] =
      DesignContext{filename, std::move(serializer), design};

  return Napi::Number::New(env, designId);
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
  // Check if the design ID exists in the designContextMap
  auto it = designContextMap.find(designId);
  if (it == designContextMap.end()) {
    Napi::Error::New(env, "Design ID not found").ThrowAsJavaScriptException();
    return env.Null();
  }
  // Get the design handle from the DesignContext
  vpiHandle design = it->second.design;
  if (!design) {
    Napi::Error::New(env, "Design not loaded").ThrowAsJavaScriptException();
    return env.Null();
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

void CollectSubScopes(const Napi::CallbackInfo& info,
                      const vpiHandle& scopeHandle, Napi::Array& result,
                      bool isFromGenScopeArray = false) {
  Napi::Env env = info.Env();
  std::vector<int> types = {vpiModule,         /*vpiModuleArray,*/ vpiGenScope,
                            vpiGenScopeArray,  vpiInterface,
                            vpiProgram,        vpiTaskFunc,
                            vpiTask,           vpiFunction,
                            vpiClockingBlock,  vpiModport,
                            vpiInterfaceArray, vpiProgramArray};

  uint32_t index =
      result.Length();  // Start from the current length of the array

  for (int type : types) {
    vpiHandle iter = vpi_iterate(type, scopeHandle);
    if (iter) {
      while (vpiHandle obj_h = vpi_scan(iter)) {
        // For GenScopeArray, get all it's subscopes recursively for one
        // level instead
        if (type == vpiGenScopeArray) {
          if (isFromGenScopeArray) {
            // If we are already in a GenScopeArray, skip this one
            continue;
          }
          CollectSubScopes(info, obj_h, result, true /*isFromGenScopeArray*/);
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
  CollectSubScopes(info, scopeHandle, result);

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

  return result;
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
  return exports;
}

NODE_API_MODULE(uhdm_addon, Init)