cmake_minimum_required(VERSION 3.24)
project(camvr_driver LANGUAGES CXX)

include(FetchContent)

FetchContent_Declare(
  openvr
  GIT_REPOSITORY https://github.com/ValveSoftware/openvr.git
  GIT_TAG 0924064316de3effbcd1acf1e309182a2deb1c05
  SOURCE_SUBDIR camvr-sdk-headers-only
)
FetchContent_MakeAvailable(openvr)

find_path(OPENVR_INCLUDE_DIR openvr_driver.h
  PATHS "${openvr_SOURCE_DIR}/headers"
  NO_DEFAULT_PATH
  REQUIRED
)
find_library(OPENVR_LIBRARY NAMES openvr_api
  PATHS "${openvr_SOURCE_DIR}/lib" "${openvr_SOURCE_DIR}/bin"
  PATH_SUFFIXES win64
  NO_DEFAULT_PATH
  REQUIRED
)

add_library(driver_camvr SHARED src/driver.cpp)
target_compile_features(driver_camvr PRIVATE cxx_std_17)
target_include_directories(driver_camvr PRIVATE "${OPENVR_INCLUDE_DIR}")
target_link_libraries(driver_camvr PRIVATE "${OPENVR_LIBRARY}" ws2_32)
set_target_properties(driver_camvr PROPERTIES
  OUTPUT_NAME "driver_camvr"
  RUNTIME_OUTPUT_DIRECTORY "$<1:${CMAKE_BINARY_DIR}/camvr/bin/win64>"
  LIBRARY_OUTPUT_DIRECTORY "$<1:${CMAKE_BINARY_DIR}/camvr/bin/win64>"
)

add_custom_command(TARGET driver_camvr POST_BUILD
  COMMAND "${CMAKE_COMMAND}" -E copy_directory
    "${CMAKE_CURRENT_SOURCE_DIR}/resources"
    "${CMAKE_BINARY_DIR}/camvr/resources"
  COMMAND "${CMAKE_COMMAND}" -E copy
    "${CMAKE_CURRENT_SOURCE_DIR}/resources/driver.vrdrivermanifest"
    "${CMAKE_BINARY_DIR}/camvr/driver.vrdrivermanifest"
)
