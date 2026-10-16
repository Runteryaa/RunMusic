cmake_minimum_required(VERSION 3.13)
project(react_codegen_BlePlx)
file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/dummy.cpp "// dummy\n")
add_library(react_codegen_BlePlx STATIC ${CMAKE_CURRENT_BINARY_DIR}/dummy.cpp)
