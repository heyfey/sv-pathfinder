{
  "variables": {
    # UHDM build directory: the third_party/UHDM submodule built by scripts/build-uhdm.sh
    # (Release, -fPIC, see that script). Override with UHDM_HOME=/path/to/uhdm/build.
    "UHDM_HOME": "<!(node -p \"require('path').resolve(process.env.UHDM_HOME || 'third_party/UHDM/build')\")",
  },
  "targets": [
    {
      "target_name": "uhdm_addon",
      "sources": ["src/uhdm_addon.cpp"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<(UHDM_HOME)/generated"
      ],
      "libraries": [
        "<(UHDM_HOME)/lib/libuhdm.a",
        "<(UHDM_HOME)/third_party/capnproto/c++/src/capnp/libcapnp.a",
        "<(UHDM_HOME)/third_party/capnproto/c++/src/kj/libkj.a",
        "-ldl",
        "-lutil",
        "-lm",
        "-lrt",
        "-lpthread"
      ],
      # The Serializer error handler aborts a mismatched restore with a C++ exception, so the
      # addon needs exceptions on (node-gyp's common.gypi turns them off by default).
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++17", "-fPIC", "-fexceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    }
  ]
}