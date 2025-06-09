{
  "variables": {
    "UHDM_HOME": "/home/heyfey/git-repos/UHDM/build",
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
      "cflags_cc": ["-std=c++17", "-fPIC"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    }
  ]
}