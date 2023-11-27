# EventNative Diagnostics

## Context and scope

This document describes the design of _diagnostics service_. This service
is responsible for answering to "What's going on now?" question: number and types of 
error, last events and so on.

## Interface

The service accepts events at different stages of [pipeline](pipeline.md) (see types in [pipeline.proto](proto/pipeline.proto)).

|Event Type                          | When                       |
|----------                          | ---                        |
|{Raw JSON, destination}             | Right after multiplexing   |
|{EventError, destination}           |                            |
|{InsertFailed, destination}         |                            |


## Internal storage

All data is stored in Redis internally as counters or collections with TTL.


## Diagnostics API


