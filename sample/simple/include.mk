# Clean rule to delete generated files
.PHONY: clean
clean:
	rm -f *.o $(TARGET)

# Rule to compile functions.c into functions.o
functions.o: functions.c functions.h
	$(CC) $(CFLAGS) -c functions.c