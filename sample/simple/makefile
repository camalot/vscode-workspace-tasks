# Variables for compiler and flags
CC = gcc
CFLAGS = -Wall -g

# The final executable name
TARGET = myprogram

# Default target executed when running 'make'
all: $(TARGET)

# Rule to link object files and create the executable
$(TARGET): main.o functions.o
	$(CC) $(CFLAGS) -o $(TARGET) main.o functions.o

# Rule to compile main.c into main.o
main.o: main.c functions.h
	$(CC) $(CFLAGS) -c main.c


