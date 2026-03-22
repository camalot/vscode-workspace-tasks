# frozen_string_literal: true

begin
  require 'rouge' unless defined?(Rouge)
  require 'rouge/regex_lexer' unless defined?(Rouge::RegexLexer)
rescue LoadError
  # Jekyll may already load Rouge via its own dependency chain.
end

module Rouge
  module Lexers
    # Taskignore Lexer
    # Syntax highlighting for .tasksignore files (similar to .gitignore)
    class Taskignore < Rouge::RegexLexer
      title 'Taskignore'
      desc 'Ignore syntax for Workspace Tasks (.tasksignore files)'
      tag 'ignore'
      aliases 'gitignore', 'tasksignore'
      filenames '.tasksignore', '.gitignore'
      mimetypes 'text/x-ignore'

      state :root do
        # Comments (highest priority). Keep comment matching on a single line.
        rule %r{^\s*#[^\n]*$}, Comment::Single

        # Whitespace-only lines (must consume at least one visible char)
        rule %r{^[ \t]+$}, Text::Whitespace

        # Negation with task-level pattern (!file@task or !*.ext@task)
        rule %r{^!([^\s@]+)(@)(\*)} do |m|
          token Operator, '!'
          token Str, m[1]
          token Operator, m[2]
          token Keyword, m[3]
        end
        rule %r{^!([^\s@]+)(@)([^\s]+)} do |m|
          token Operator, '!'
          token Str, m[1]
          token Operator, m[2]
          token Name, m[3]
        end

        # Task-level filtering (file@task or *.ext@task)
        rule %r{^([^\s@]+)(@)(\*)} do |m|
          token Str, m[1]
          token Operator, m[2]
          token Keyword, m[3]
        end
        rule %r{^([^\s@]+)(@)([^\s]+)} do |m|
          token Str, m[1]
          token Operator, m[2]
          token Name, m[3]
        end

        # Negation patterns (! prefix)
        rule %r{^!}, Operator

        # Directory patterns (ending with /)
        rule %r{[^\s]+/}, Str::Symbol

        # Glob patterns ** (recursive)
        rule %r{\*\*}, Keyword

        # Single wildcard *
        rule %r{\*}, Keyword

        # Character class ?
        rule %r{\?}, Keyword

        # File patterns and other text
        rule %r{[^\s#@*?/\n]+}, Str

        # Whitespace (including newlines)
        rule %r{\s+}m, Text::Whitespace
      end
    end
  end
end
