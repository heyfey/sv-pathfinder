#include <napi.h>
#include <uhdm/ElaboratorListener.h>
#include <uhdm/VpiListener.h>
#include <uhdm/uhdm.h>
#include <uhdm/vpi_user.h>

#include <map>
#include <string>
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

// Global variables
UHDM::Serializer serializer;
std::map<std::string, vpiHandle> moduleMap;
vpiHandle design = nullptr;

// Function to load UHDM design
Napi::Value LoadDesign(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "String argument (filename) expected")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string filename = info[0].As<Napi::String>().Utf8Value();
  const std::vector<vpiHandle>& restoredDesigns = serializer.Restore(filename);
  if (restoredDesigns.empty()) {
    Napi::Error::New(env, "Failed to restore design from " + filename)
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  design = restoredDesigns[0]; // Only consider the first design
  if (!vpi_get(vpiElaborated, design)) {
    UHDM::ElaboratorContext* elaboratorContext =
        new UHDM::ElaboratorContext(&serializer);
    elaboratorContext->m_elaborator.listenDesigns(restoredDesigns);
    delete elaboratorContext;
  }

  return Napi::String::New(env, "Design loaded successfully");
}

// Wrap getTopModules
Napi::Value GetTopModules(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!design) {
    Napi::Error::New(env, "Design not loaded").ThrowAsJavaScriptException();
    return env.Null();
  }

  vpiHandle instItr = vpi_iterate(UHDM::uhdmtopModules, design);
  Napi::Array result = Napi::Array::New(env);
  uint32_t index = 0;

  while (vpiHandle obj_h = vpi_scan(instItr)) {
    Napi::Object module = Napi::Object::New(env);
    if (const char* s = vpi_get_str(vpiDefName, obj_h))
      module.Set("defName", s);
    if (const char* s = vpi_get_str(vpiName, obj_h)) module.Set("name", s);
    if (const char* s = vpi_get_str(vpiFile, obj_h)) module.Set("file", s);
    module.Set("line", vpi_get(vpiLineNo, obj_h));
    module.Set("column", vpi_get(vpiColumnNo, obj_h));
    module.Set("handle", VpiHandleWrap::New(env, obj_h));
    result[index++] = module;
    // vpi_release_handle(obj_h); // Do not release here; VpiHandleWrap will
    // manage it
  }
  vpi_release_handle(instItr);
  return result;
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

  // Ensure the design is loaded
  if (!design) {
    Napi::Error::New(env, "Design not loaded").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Unwrap the VpiHandleWrap object to get the C++ instance
  VpiHandleWrap* wrap = VpiHandleWrap::Unwrap(info[0].As<Napi::Object>());
  vpiHandle instHandle = wrap->GetHandle();

  // If the handle is null, return an empty array
  if (!instHandle) {
    return Napi::Array::New(env, 0);
  }

  // Iterate over submodules using the provided handle
  vpiHandle instItr = vpi_iterate(vpiModule, instHandle);
  Napi::Array result = Napi::Array::New(env);
  uint32_t index = 0;

  while (vpiHandle obj_h = vpi_scan(instItr)) {
    Napi::Object module = Napi::Object::New(env);
    if (const char* s = vpi_get_str(vpiDefName, obj_h))
      module.Set("defName", s);
    if (const char* s = vpi_get_str(vpiFullName, obj_h)) module.Set("name", s);
    if (const char* s = vpi_get_str(vpiFile, obj_h)) module.Set("file", s);
    module.Set("line", vpi_get(vpiLineNo, obj_h));
    module.Set("column", vpi_get(vpiColumnNo, obj_h));
    module.Set("handle", VpiHandleWrap::New(env, obj_h));
    result[index++] = module;
    // vpi_release_handle(obj_h); // Do not release here; VpiHandleWrap will
    // manage it
  }

  // TODO: Handle genScopes, functions, etc.

  // Release the iterator
  vpi_release_handle(instItr);
  // Do NOT release instHandle here; it’s managed by VpiHandleWrap

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
  vpiHandle instHandle = wrap->GetHandle();

  // Create an array to hold variable information
  Napi::Array result = Napi::Array::New(env);
  uint32_t index = 0;

  // Helper lambda to collect variables of a specific type
  auto collectVars = [&](int type, const std::string& typeName) {
    vpiHandle iter = vpi_iterate(type, instHandle);
    if (iter) {
      while (vpiHandle obj_h = vpi_scan(iter)) {
        Napi::Object var = Napi::Object::New(env);
        var.Set("type", typeName);
        if (const char* name = vpi_get_str(vpiFullName, obj_h)) {
          var.Set("name", name);
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
  collectVars(vpiReg, "reg");
  collectVars(vpiIntegerVar, "integer");
  collectVars(vpiRealVar, "real");

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
  if (const char* s = vpi_get_str(vpiDefName, instHandle)) result.Set("defName", s);
  if (const char* s = vpi_get_str(vpiDefFile, instHandle)) result.Set("file", s);
  result.Set("line", vpi_get(vpiDefLineNo, instHandle));

  return result;
}

// Initialize the addon
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  VpiHandleWrap::Init(env);  // Set up the VpiHandleWrap class
  exports.Set("loadDesign", Napi::Function::New(env, LoadDesign));
  exports.Set("getTopModules", Napi::Function::New(env, GetTopModules));
  exports.Set("getSubScopes", Napi::Function::New(env, GetSubScopes));
  exports.Set("getVars", Napi::Function::New(env, GetVars));
  exports.Set("getModuleDef", Napi::Function::New(env, GetModuleDef));
  return exports;
}

NODE_API_MODULE(uhdm_addon, Init)