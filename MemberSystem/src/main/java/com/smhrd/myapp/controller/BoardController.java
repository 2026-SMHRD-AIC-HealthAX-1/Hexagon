package com.smhrd.myapp.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class BoardController {

	
	// BoardWrite.html로 페이지 이동
	@GetMapping("/boardWrite")
	public String boardWrite() {
		return "BoardWrite";
	}
	
	// BoardMain.html로 페이지 이동
	@GetMapping("/boardMain")
	public String boardMain() {
		return "BoardMain";
	}
	
	
}
